
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CalculatedPriceSet, ProductDTO, ProductOptionValueDTO, ProductVariantDTO, SalesChannelDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, getVariantAvailability, Modules, QueryContext } from "@medusajs/framework/utils";
import z from "zod";


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
  currency: z.string().optional(),
})

export type RouteSchema = z.infer<typeof schema>;

export async function GET(
  req: MedusaRequest<{}, RouteSchema>,
  res: MedusaResponse
) {
  const regionsModule = req.scope.resolve(Modules.REGION);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

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

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["*", "variants.*", "variants.calculated_price.*", "variants.options.*", "sales_channels.*", "type.*"],
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

    const ProductVariantWithAvailability = {
      ...product,
      variants: product.variants.map((variant) => {
        return {
          ...variant,
          availability: available[variant.id]?.availability || 0,
        }
      })
    }
    return ProductVariantWithAvailability;



  });

  // Wait for all availability checks to complete
  const productsWithAvailability = await Promise.all(availabilityPromises) as unknown as extendedProductVariantDTO[]



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

  const mappedVariants = productsWithAvailability.flatMap((product) => {
    const variants = product.variants.map((variant: ExtendedVariantDTO) => {
      const variantOptions = handleVariantOptions(variant.options);

      const defaultPrice = `${variant.calculated_price.original_amount} ${currency_code}`
      const salesPrice = `${variant.calculated_price.calculated_amount} ${currency_code}`


      return {
        id: variant.id,
        itemgroup_id: product.id,
        title: product.title,
        description: product.description,
        link: product.handle,
        image_link: product?.thumbnail,
        price: defaultPrice,
        ...variantOptions,
        availability: variant.availability,
        mpn: variant.sku,
        product_type: product.type?.value,
        sale_price: salesPrice,
        material: product.material || "",
      }
    })
    return variants

  })

  res.json(mappedVariants);
}
