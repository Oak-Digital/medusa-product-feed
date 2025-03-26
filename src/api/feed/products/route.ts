import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CalculatedPriceSet, ProductDTO, ProductOptionValueDTO, ProductVariantDTO, SalesChannelDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, getVariantAvailability, Modules, QueryContext } from "@medusajs/framework/utils";
import z from "zod";


// id
// itemgroup_id (hovedprodukt)
// title
// description
// link
// image_link
// price
// availability
// (-) brand
// (-) condition
// (-) gtin
// mpn (sku)
// color (hvis tilgængeligt)
// size (hvis tilgængeligt)
// product_type
// google_product_category
// sale_price
// material (hvis tilgængeligt)
//

type ExtendedVariantDTO = ProductVariantDTO & {
  calculated_price: CalculatedPriceSet
}

type extendedProductVariantDTO = ProductDTO & {
  variants: ExtendedVariantDTO[]
  sales_channels: SalesChannelDTO[]
}


type VariantAvailabilityData = {
  variant_ids: string[];
  sales_channel_id: string;
};

type VariantAvailabilityResult = {
  [variant_id: string]: {
    /**
     * The available inventory quantity for the variant in the sales channel.
     */
    availability: number;
    /**
     * The ID of the sales channel for which the availability was computed.
     */
    sales_channel_id: string;
  };
};


const schema = z.object({
  currency_code: z.string().optional(),
})

export type RouteSchema = z.infer<typeof schema>;

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const regionsModule = req.scope.resolve(Modules.REGION);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);

  const result = schema.safeParse(req.query);


  const regions = await regionsModule.listRegions()

  const defaultRegion = regions[0];

  let region_id: string = defaultRegion.id;
  let currency_code: string = defaultRegion.currency_code;

  if (!regions.length) {
    return res.status(404).json({
      message: "No regions found",
    })
  }

  if (result.success && result?.data.currency_code) {
    const region = regions.find((region) => region.currency_code === result.data.currency_code);

    if (!region) {
      return res.status(404).json({
        message: "No region found with currency code",
      })
    }

    region_id = region.id;
    currency_code = region.currency_code;
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["*", "variants.*", "variants.calculated_price.*", "variants.options.*", "sales_channels.*"],
    context: {
      variants: {
        calculated_price: QueryContext({
          region_id: region_id,
          currency_code: currency_code,
        }),
      },
    },
  }) as { data: extendedProductVariantDTO[] }

  const availabilityPromises = products.map(async (product) => {
    // Get variant IDs without async (which was causing Promise arrays)
    const variantIds = product.variants.map(variant => variant.id);

    // Get sales channel ID if available
    const salesChannelId = product.sales_channels.length > 0 ?
      product.sales_channels[0].id : null;

    if (!salesChannelId) {
      return []; // Return empty array if no sales channel
    }

    const variantIDWithSalesChannel: VariantAvailabilityData = {
      variant_ids: variantIds,
      sales_channel_id: salesChannelId,
    };

    // Return the availability data for this product's variants
    const available = await getVariantAvailability(query, variantIDWithSalesChannel);

    return {
      ...product,
      variants: product.variants.map((variant) => ({
        return {
          ...variant,
          available: available[variant.id].availability,
        }
      }))
    }

  });

  // Wait for all availability checks to complete
  const productsWithAvailability = await Promise.all(availabilityPromises);






  const handleVariantOptions = (options: ProductOptionValueDTO[]) => {
    // Create an object with option titles as keys and their values as values
    const result: Record<string, string> = {};

    options.forEach((optionValue) => {
      if (optionValue.option && optionValue.option.title && optionValue.value) {
        // Use the option title (e.g., "Size", "Color") as the key
        result[optionValue.option.title.toLowerCase()] = optionValue.value;
      }
    });

    return result;
  }





  const mappedVariants = products.map((product) => {
    const variants = product.variants.map((variant: ExtendedVariantDTO) => {


      const variantOptions = handleVariantOptions(variant.options);

      return {
        id: variant.id,
        itemgroup_id: product.id,
        title: variant.title,
        description: product.description,
        link: product.handle,
        image_link: product.thumbnail,
        price: variant.calculated_price?.original_price || variant.calculated_price?.calculated_amount || "missing price",
        ...variantOptions,
        availability: variant.manage_inventory,
        mpn: variant.sku,
        product_type: product?.product_type || "",
        sale_price: variant.calculated_price?.calculated_amount || variant.calculated_price?.original_price,
        material: variant.material || "",
      }
    })
    return variants

  })

  res.json(mappedVariants);
}
