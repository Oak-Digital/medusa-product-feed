import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CalculatedPriceSet, ProductDTO, ProductVariantDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, QueryContext } from "@medusajs/framework/utils";
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
}

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
    fields: ["*", "variants.*", "variants.calculated_price.*",],
    context: {
      variants: {
        calculated_price: QueryContext({
          region_id: region_id,
          currency_code: currency_code,
        }),
      },
    },
  }) as { data: extendedProductVariantDTO[] }

  const mappedVariants = products.map((product) => {
    const variants = product.variants.map((variant) => {
      return {
        id: variant.id,
        itemgroup_id: product.id,
        title: variant.title,
        description: product.description,
        link: product.handle,
        image_link: product.thumbnail,
        price: variant.calculated_price.calculated_amount,
        // availability: variant.availability,
        // other: {
        //   ...variant
        // }
        // brand: variant.brand,
        // condition: variant.condition,
        // gtin: variant.gtin,
        // mpn: variant.mpn,
        // color: variant.color,
        // size: variant.size,
        // product_type: variant.product_type,
        // google_product_category: variant.google_product_category,
        // sale_price: variant.sale_price,
        // material: variant.material,
      }
    })
    return variants

  })

  res.json(mappedVariants);
}
