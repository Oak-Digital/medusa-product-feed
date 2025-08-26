import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import z from "zod";
import { PRODUCT_FEED_MODULE } from "../../../../modules/product-feed";
import ProductFeedService from "../../../../modules/product-feed/service";
import { RegionDTO } from "@medusajs/framework/types";

const schema = z.object({
  country_code: z.string().optional(),
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

  const regions = await regionsModule.listRegions({}, {
    relations: ["countries"]
  })


  const defaultRegion = regions[0];

  let region_id: string = defaultRegion?.id;
  let currency_code: string = defaultRegion?.currency_code;

  if (!regions.length) {
    return res.status(404).json({
      message: "No regions found",
    })
  }

  if (result.success) {
    // Prefer country_code when provided
    if (result.data?.country_code) {
      const cc = result.data.country_code.toLowerCase()
      const regionByCountry = regions.find((r: RegionDTO) =>
        Array.isArray((r).countries) && (r).countries.some((c) => (c?.iso_2 || c?.iso_3)?.toLowerCase?.() === cc)
      )

      if (!regionByCountry) {
        return res.status(404).json({
          message: "No region found for country code",
        })
      }

      region_id = regionByCountry.id
      currency_code = regionByCountry.currency_code
    } else if (result.data?.currency) {
      const region = regions.find((region) => region.currency_code === result.data.currency);

      if (!region) {
        return res.status(404).json({
          message: "No region found with currency code",
        })
      }

      region_id = region.id;
      currency_code = region.currency_code;
    }
  }

  // Delegate to reusable builder
  const items = await pf.buildMappedFeedData({
    regionsModule,
    productModule,
    query,
    regionId: region_id,
    currencyCode: currency_code,
    mode: "json",
  })

  res.status(200).json(items);
}
