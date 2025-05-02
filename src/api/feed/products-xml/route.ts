import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CalculatedPriceSet, ProductDTO, ProductOptionValueDTO, ProductVariantDTO, SalesChannelDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, getVariantAvailability, Modules, QueryContext } from "@medusajs/framework/utils";
import { Builder } from "xml2js";
import z from "zod";
import { PRODUCT_FEED_MODULE } from "../../../modules/product-feed";
import ProductFeedService from "../../../modules/product-feed/service";


type ExtendedVariantDTO = ProductVariantDTO & {
  calculated_price: CalculatedPriceSet
  availability: number;
}

type extendedProductVariantDTO = ProductDTO & {
  variants: ExtendedVariantDTO[]
  sales_channels: SalesChannelDTO[]
}


type VariantAvailabilityData = {
  variant_ids: string[];
  sales_channel_id: string;
};


const schema = z.object({
  currency: z.string().optional(),
})

export type RouteSchema = z.infer<typeof schema>;

export async function GET(
  req: MedusaRequest<{}, RouteSchema>,
  res: MedusaResponse
) {
  const regionsModule = req.scope.resolve(Modules.REGION);
  const productModule = req.scope.resolve(Modules.PRODUCT);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const pf: ProductFeedService = req.scope.resolve(PRODUCT_FEED_MODULE);

  const result = schema.safeParse(req.query);

  const regions = await regionsModule.listRegions()

  const defaultRegion = regions[0];

  let region_id: string = defaultRegion.id;
  let currency_code: string = defaultRegion.currency_code;

  // Internal batch size configuration - not exposed via query params
  const BATCH_SIZE = 50;

  if (!regions.length) {
    return res.status(404).json({
      message: "No regions found",
    })
  }

  if (result.success && result?.data.currency) {
    const region = regions.find((region) => region.currency_code === result.data.currency);

    if (!region) {
      return res.status(404).json({
        message: "No region found with currency code",
      })
    }

    region_id = region.id;
    currency_code = region.currency_code;
  }

  // First, get count of products to determine number of batches
  const [, count] = await productModule.listAndCountProducts();

  const totalProducts = count || 0;
  const batches = Math.ceil(totalProducts / BATCH_SIZE);

  // Array to hold the final mapped variant data
  let mappedVariants: any[] = [];

  // Process products in batches
  for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
    const offset = batchIndex * BATCH_SIZE;

    // Fetch only the required fields
    const { data: productBatch } = await query.graph({
      entity: "product",
      fields: [
        "id", "title", "description", "handle", "thumbnail", "material", // Product fields
        "type.value", // ProductType fields
        "sales_channels.id", // SalesChannel fields
        "variants.id", "variants.sku", // Variant fields
        "variants.options.value", "variants.options.option.title", // VariantOption fields
        "variants.calculated_price.original_amount", // CalculatedPriceSet fields
        "variants.calculated_price.calculated_amount"
      ],
      context: {
        variants: {
          calculated_price: QueryContext({
            region_id: region_id,
            currency_code: currency_code,
          }),
        },
      },
      pagination: {
        take: BATCH_SIZE,
        skip: offset,
      }
    }) as { data: extendedProductVariantDTO[] }; // Type needs adjustment if not all fields are present

    // --- Optimized Availability Fetching ---
    const salesChannelVariantMap = new Map<string, string[]>(); // Map<salesChannelId, variantId[]>

    // Collect variants grouped by sales channel
    for (const product of productBatch) {
      if (product.sales_channels.length > 0) {
        const scId = product.sales_channels[0].id;
        if (!salesChannelVariantMap.has(scId)) {
          salesChannelVariantMap.set(scId, []);
        }
        const variantIdsForSC = salesChannelVariantMap.get(scId)!;
        for (const variant of product.variants) {
          variantIdsForSC.push(variant.id);
        }
      }
    }

    // Fetch availability for each sales channel group
    const availabilityMap = new Map<string, { availability: number }>();
    const availabilityPromises = [];

    for (const [scId, variantIds] of salesChannelVariantMap.entries()) {
      if (variantIds.length > 0) {
        availabilityPromises.push(
          // @ts-ignore
          getVariantAvailability(query, { variant_ids: variantIds, sales_channel_id: scId })
        );
      }
    }

    // Combine results into a single map keyed by variant ID
    const availabilityResults = await Promise.all(availabilityPromises);
    for (const result of availabilityResults) {
      for (const variantId in result) {
        availabilityMap.set(variantId, result[variantId]);
      }
    }
    // --- End Optimized Availability Fetching ---


    // --- Incremental Mapping ---
    const handleVariantOptions = (options: ProductOptionValueDTO[]) => {
      // Create an object with option titles as keys and their values as values
      const result: Record<string, string> = {};

      // Function to sanitize keys for XML element names
      const sanitizeXmlName = (name: string): string => {
        // Convert to lowercase
        let sanitized = name.toLowerCase();

        // Specific replacements for Danish characters
        sanitized = sanitized.replace(/æ/g, 'ae');
        sanitized = sanitized.replace(/ø/g, 'oe');
        sanitized = sanitized.replace(/å/g, 'aa');

        // Replace remaining invalid XML characters (anything not a-z, 0-9, or _) with underscore
        sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');

        // Ensure it doesn't start with a number or underscore (if necessary, prepend a character)
        // XML names must start with a letter or underscore.
        if (!/^[a-z_]/.test(sanitized)) {
          sanitized = 'opt_' + sanitized; // Prepend 'opt_' if it starts with a digit or other invalid start char
        }
        return sanitized;
      };

      options.forEach((optionValue) => {
        if (optionValue.option && optionValue.option.title && optionValue.value) {
          // Sanitize the option title to create a valid XML element name
          const key = sanitizeXmlName(optionValue.option.title);
          result[`g:${key}`] = optionValue.value;
        }
      });

      return result;
    }

    // Map products in the current batch
    const batchMappedVariants = productBatch.flatMap((product) => {
      const variants = product.variants
        .filter((variant: ExtendedVariantDTO) => variant.calculated_price?.original_amount !== undefined)
        .map((variant: ExtendedVariantDTO) => {
          const variantOptions = handleVariantOptions(variant.options);
          const availability = availabilityMap.get(variant.id)?.availability || 0; // Get availability from map

          const defaultPrice = `${variant.calculated_price?.original_amount} ${currency_code}`
          const salesPrice = `${variant.calculated_price?.calculated_amount} ${currency_code}`

          // Convert variantOptions object to URL query parameters
          const linkableOptions = Object.entries(variantOptions)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');

          // Map data to Google Feed specification (g: prefix for standard fields)
          const itemData: Record<string, any> = {
            'g:id': variant.id, // Unique identifier for the variant
            'g:item_group_id': product.id, // Common identifier for all variants of the same product
            'g:title': product.title,
            'g:description': product.description,
            'g:link': `https://phertz.dk/smykke/${product.handle}?${linkableOptions}`, // Link to the specific variant page
            'g:image_link': product?.thumbnail, // Use product thumbnail, consider variant image if available
            'g:brand': "P. Hertz",
            'g:condition': "new",
            'g:availability': availability > 0 ? "in stock" : "out of stock",
            'g:price': defaultPrice,
            'g:sale_price': salesPrice,
            'g:mpn': variant.sku, // Manufacturer Part Number (SKU)
            'g:product_type': product.type?.value,
            'g:material': product.material || "",
            // Add custom variant options without 'g:' prefix
            ...variantOptions,
          };

          // Remove keys with empty/null values to keep the XML clean
          Object.keys(itemData).forEach(key => {
            if (itemData[key] === null || itemData[key] === "" || itemData[key] === undefined) {
              delete itemData[key];
            }
          });

          return itemData;
        })
      return variants
    });

    // Append batch results to the main array
    mappedVariants = mappedVariants.concat(batchMappedVariants);
    // --- End Incremental Mapping ---
  } // End of batch loop


  const options = pf.getOptions();
  // Structure the data for XML conversion according to RSS 2.0 and Google Feed spec
  const feedObject = {
    rss: {
      $: { // Attributes for the <rss> tag
        'xmlns:g': 'http://base.google.com/ns/1.0',
        version: '2.0',
      },
      channel: {
        title: options.title, // Customize as needed
        link: options.link,      // Store's base URL
        description: options.description, // Customize as needed
        item: mappedVariants, // Array of item objects
      },
    },
  };

  // Configure the XML builder
  // - `rootName`: Ensures the root element is 'rss' (though structure implies it)
  // - `headless`: Set to true to avoid the <?xml ...?> declaration if not desired (Facebook/Google usually accept it)
  // - `cdata`: Set to true to wrap text nodes in CDATA sections, which can help prevent issues with special characters in descriptions, etc.
  const builder = new Builder({
    // rootName: 'rss',
    headless: false, // Keep the XML declaration
    cdata: true,     // Use CDATA for text nodes
  });
  const xml = builder.buildObject(feedObject);

  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
}
