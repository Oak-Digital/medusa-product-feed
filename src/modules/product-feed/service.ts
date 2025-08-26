import { CalculatedPriceSet, ProductDTO, ProductOptionValueDTO, ProductVariantDTO, SalesChannelDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, getVariantAvailability, Modules, QueryContext } from "@medusajs/framework/utils";

type ProductFeedOptions = {
  title: string, // Customize as needed
  link: string,      // Store's base URL
  description: string, // Customize as needed
  brand?: string, // Optional brand field
}

export default class ProductFeedService {
  protected options_: ProductFeedOptions

  constructor({ }, options?: ProductFeedOptions) {
    this.options_ = options || {
      title: 'Product Feed',
      link: 'https://example.com', // Replace with your store's base URL
      description: 'A feed of products from our store',
      brand: 'Example Brand', // Optional brand field
    }
  }

  getOptions() {
    return this.options_
  }

  // Methods to generate the product feed
  /**
   * Build mapped feed data for products/variants with region-based pricing.
   * - Performs batched fetching, availability lookup, and mapping.
   * - Can output mapping for JSON feed (plain keys) or XML feed (g:-prefixed keys).
   */
  async buildMappedFeedData(args: {
    // Required Medusa dependencies (pass from req.scope.resolve(...))
    regionsModule: any
    productModule: any
    query: any

    // Region selection
    regionId?: string
    currencyCode?: string

    // Output mode
    mode?: "json" | "xml"

    // Internal tuning
    batchSize?: number
  }): Promise<any[]> {
    const {
      regionsModule,
      productModule,
      query,
      regionId,
      currencyCode,
      mode = "json",
      batchSize = 50,
    } = args

    const options = this.getOptions()
    const store_url = options.link || "https://example.com"
    const brand = options.brand || "My Store"

    // Resolve region and currency
    const regions = await regionsModule.listRegions()
    if (!regions?.length) {
      return []
    }

    const regionById = regionId ? regions.find((r: any) => r.id === regionId) : undefined
    const regionByCurrency = currencyCode ? regions.find((r: any) => r.currency_code === currencyCode) : undefined

    const selectedRegion = regionById || regionByCurrency || regions[0]

    const selectedRegionId: string = selectedRegion.id
    const selectedCurrencyCode: string = selectedRegion.currency_code

    type ExtendedVariantDTO = ProductVariantDTO & {
      calculated_price: CalculatedPriceSet
      availability: number
    }

    type ExtendedProductDTO = ProductDTO & {
      variants: ExtendedVariantDTO[]
      sales_channels: SalesChannelDTO[]
    }

    // 1) Count to determine batches
    const [, count] = await productModule.listAndCountProducts()
    const totalProducts = count || 0
    const batches = Math.ceil(totalProducts / batchSize)

    let mappedVariants: any[] = []

    // Helpers
    const sanitizeXmlName = (name: string): string => {
      let sanitized = name.toLowerCase()
      sanitized = sanitized.replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
      sanitized = sanitized.replace(/[^a-z0-9_]/g, "_")
      if (!/^[a-z_]/.test(sanitized)) {
        sanitized = "opt_" + sanitized
      }
      return sanitized
    }

    const handleVariantOptions = (options: ProductOptionValueDTO[]) => {
      const result: Record<string, string> = {}
      options.forEach((optionValue) => {
        if (
          optionValue.value.includes("Default") ||
          optionValue.value.includes("default")
        ) {
          return
        }

        if (optionValue.option?.title && optionValue.value) {
          if (mode === "xml") {
            const key = sanitizeXmlName(optionValue.option.title)
            result[`g:${key}`] = optionValue.value
          } else {
            result[optionValue.option.title.toLowerCase()] = optionValue.value
          }
        }
      })
      return result
    }

    // 2) Process in batches
    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const offset = batchIndex * batchSize

      const { data: productBatch } = (await query.graph({
        entity: "product",
        fields: [
          "id",
          "title",
          "description",
          "handle",
          "thumbnail",
          "images.url",
          "material",
          "type.value",
          "sales_channels.id",
          "variants.id",
          "variants.sku",
          "variants.options.value",
          "variants.options.option.title",
          "variants.calculated_price.original_amount",
          "variants.calculated_price.calculated_amount",
        ],
        context: {
          variants: {
            calculated_price: QueryContext({
              region_id: selectedRegionId,
              currency_code: selectedCurrencyCode,
            }),
          },
        },
        pagination: {
          take: batchSize,
          skip: offset,
        },
      })) as { data: ExtendedProductDTO[] }

      // Build availability map per sales channel group
      const salesChannelVariantMap = new Map<string, string[]>()
      for (const product of productBatch) {
        if (product.sales_channels?.length > 0) {
          const scId = product.sales_channels[0].id
          if (!salesChannelVariantMap.has(scId)) {
            salesChannelVariantMap.set(scId, [])
          }
          const list = salesChannelVariantMap.get(scId)!
          for (const variant of product.variants) {
            list.push(variant.id)
          }
        }
      }

      const availabilityMap = new Map<string, { availability: number }>()
      const availabilityPromises: Promise<Record<string, { availability: number }>>[] = []
      for (const [scId, variantIds] of salesChannelVariantMap.entries()) {
        if (variantIds.length > 0) {
          // @ts-ignore - framework util returns an object keyed by variant id
          availabilityPromises.push(
            getVariantAvailability(query, {
              variant_ids: variantIds,
              sales_channel_id: scId,
            })
          )
        }
      }
      const availabilityResults = await Promise.all(availabilityPromises)
      for (const result of availabilityResults) {
        for (const variantId in result) {
          availabilityMap.set(variantId, result[variantId])
        }
      }

      // Map batch
      const batchMapped = productBatch.flatMap((product) => {
        return product.variants
          .filter((variant: ExtendedVariantDTO) => variant.calculated_price?.original_amount !== undefined)
          .map((variant: ExtendedVariantDTO) => {
            const variantOptions = handleVariantOptions(variant.options)
            const availability = availabilityMap.get(variant.id)?.availability || 0
            const defaultPrice = `${variant.calculated_price?.original_amount} ${selectedCurrencyCode}`
            const salesPrice = `${variant.calculated_price?.calculated_amount} ${selectedCurrencyCode}`

            const linkableOptions = Object.entries(variantOptions)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
              .join("&")

            if (mode === "xml") {
              const itemData: Record<string, any> = {
                "g:id": variant.id,
                "g:item_group_id": product.id,
                "g:title": product.title,
                "g:description": product.description,
                "g:link": `${store_url}/${product.handle}?${linkableOptions}`,
                "g:image_link": product?.thumbnail,
                "g:addtional_image_1": product?.images?.[0]?.url,
                "g:addtional_image_2": product?.images?.[1]?.url,
                "g:brand": `${brand}`,
                "g:condition": "new",
                "g:availability": availability > 0 ? "in stock" : "out of stock",
                "g:price": defaultPrice,
                "g:sale_price": salesPrice,
                "g:mpn": variant.sku,
                "g:product_type": (product as any).type?.value,
                "g:material": (product as any).material || "",
                ...variantOptions,
              }
              // strip empty values
              Object.keys(itemData).forEach((key) => {
                if (
                  itemData[key] === null ||
                  itemData[key] === undefined ||
                  itemData[key] === ""
                ) {
                  delete itemData[key]
                }
              })
              return itemData
            }

            // JSON mode
            return {
              id: variant.id,
              itemgroup_id: product.id,
              title: product.title,
              description: product.description,
              link: `${store_url}/${product.handle}?${linkableOptions}`,
              image_link: product?.thumbnail,
              addtional_image_1: (product as any)?.images?.[0]?.url,
              addtional_image_2: (product as any)?.images?.[1]?.url,
              price: defaultPrice,
              ...variantOptions,
              availability,
              mpn: variant.sku,
              product_type: (product as any).type?.value,
              sale_price: salesPrice,
              material: (product as any).material || "",
            }
          })
      })

      mappedVariants = mappedVariants.concat(batchMapped)
    }

    return mappedVariants
  }
}

