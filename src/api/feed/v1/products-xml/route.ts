import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { Builder } from "xml2js";
import z from "zod";
import { PRODUCT_FEED_MODULE } from "../../../../modules/product-feed";
import ProductFeedService from "../../../../modules/product-feed/service";


const schema = z.object({
  country_code: z.string().optional(),
  currency: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().optional(),
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

  let region_id: string = defaultRegion?.id;
  let currency_code: string = defaultRegion?.currency_code;

  if (!regions.length) {
    return res.status(404).json({
      message: "No regions found",
    })
  }

  if (result.success) {
    if (result.data?.country_code) {
      const cc = result.data.country_code.toLowerCase()
      const regionByCountry = regions.find((r: any) =>
        Array.isArray((r as any).countries) && (r as any).countries.some((c: any) => (c?.iso_2 || c?.iso2 || c?.code)?.toLowerCase?.() === cc)
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
  const xml = await pf.buildFeedXml({
    regionsModule,
    productModule,
    query,
    regionId: region_id,
    currencyCode: currency_code,
    page: result.success ? result.data?.page : undefined,
    pageSize: result.success ? result.data?.page_size : undefined,
  })



  res.setHeader("Content-Type", "application/xml");
  res.status(200).send(xml);
}
