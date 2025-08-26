import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { Builder } from "xml2js";
import z from "zod";
import { PRODUCT_FEED_MODULE } from "../../../../modules/product-feed";
import ProductFeedService from "../../../../modules/product-feed/service";


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
  const mappedVariants = await pf.buildMappedFeedData({
    regionsModule,
    productModule,
    query,
    regionId: region_id,
    currencyCode: currency_code,
    mode: "xml",
  })


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
