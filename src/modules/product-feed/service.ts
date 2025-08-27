import { ProductOptionValueDTO } from "@medusajs/framework/types";
import { getVariantAvailability, QueryContext } from "@medusajs/framework/utils";
import { ExtendedProductDTO, ExtendedVariantDTO } from "./types";

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

    // Google Merchant namespace control
    // When true, XML keys are prefixed with `g:`. When false, no prefix.
    GoogleMerchant?: boolean

    // Optional hooks for client-specific customization
    // Called for every mapped item (variant). Return the final item to include in the feed.
    itemTransform?: (item: any, ctx: {
      product: ExtendedProductDTO
      variant: ExtendedVariantDTO
      availability: number
      regionId: string
      currencyCode: string
    }) => any | Promise<any>

    // Optionally include or exclude fields from each item after transform
    includeFields?: string[]
    excludeFields?: string[]




    // Internal tuning
    batchSize?: number

    // Optional pagination (by products page)
    // If provided, only that page of products is processed.
    // Note: Pagination is by products; number of returned items varies with variants per product.
    page?: number
    pageSize?: number
  }): Promise<any[]> {
    const {
      regionsModule,
      productModule,
      query,
      regionId,
      currencyCode,
      mode = "json",
      GoogleMerchant = false,
      batchSize = 50,
      page,
      pageSize,
      itemTransform,
      includeFields,
      excludeFields,
    } = args

    const options = this.getOptions()
    const store_url = options.link || "https://example.com"
    const brand = options?.brand || undefined

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


    // 1) Count to determine batches
    const [, count] = await productModule.listAndCountProducts()
    const totalProducts = count || 0
    const effectiveBatchSize = Math.max(1, pageSize ?? batchSize)
    const batches = Math.ceil(totalProducts / effectiveBatchSize)

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
            const finalKey = GoogleMerchant ? `g:${key}` : key
            result[finalKey] = optionValue.value
          } else {
            result[optionValue.option.title.toLowerCase()] = optionValue.value
          }
        }
      })
      return result
    }

    // 2) Process in batches
    // Determine which batches to process
    const startBatch = typeof page === 'number' && page > 0 ? page - 1 : 0
    const endBatch = typeof page === 'number' && page > 0 ? startBatch : batches - 1

    for (let batchIndex = startBatch; batchIndex <= endBatch; batchIndex++) {
      const offset = batchIndex * effectiveBatchSize

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
          "variants.barcode",
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
          take: effectiveBatchSize,
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
      const batchMapped = await Promise.all(
        productBatch.flatMap((product) => {
          return product.variants
            .filter((variant: ExtendedVariantDTO) => variant.calculated_price?.original_amount !== undefined)
            .map(async (variant: ExtendedVariantDTO) => {
              const variantOptions = handleVariantOptions(variant.options)
              const availability = availabilityMap.get(variant.id)?.availability || 0
              const defaultPrice = `${variant.calculated_price?.original_amount} ${selectedCurrencyCode.toUpperCase()}`
              const salesPrice = `${variant.calculated_price?.calculated_amount} ${selectedCurrencyCode.toUpperCase()}`

              const linkableOptions = Object.entries(variantOptions)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join("&")

              if (mode === "xml") {
                const g = (k: string) => (GoogleMerchant ? `g:${k}` : k)
                const thumbnail = product?.thumbnail
                const rawImages: (string | undefined)[] = [
                  product?.images?.[0]?.url,
                  product?.images?.[1]?.url,
                  product?.images?.[2]?.url,
                ]
                const additionalImages: string[] = []
                for (const url of rawImages) {
                  if (!url) continue
                  if (url === thumbnail) continue
                  if (additionalImages.includes(url)) continue
                  additionalImages.push(url)
                }
                let itemData: Record<string, any> = {
                  [g("id")]: variant.id,
                  [g("item_group_id")]: product.id,
                  [g("title")]: product.title,
                  [g("description")]: product.description,
                  [g("link")]: `${store_url}/${product.handle}?${linkableOptions}`,
                  [g("image_link")]: thumbnail,
                  [g("additional_image_1")]: additionalImages[0],
                  [g("additional_image_2")]: additionalImages[1],
                  [g("brand")]: brand || product.type?.value,
                  [g("condition")]: "new",
                  [g("availability")]: availability > 0 ? "in stock" : "out of stock",
                  [g("price")]: defaultPrice,
                  [g("sale_price")]: salesPrice,
                  [g("mpn")]: variant.sku,
                  [g("product_type")]: (product as any).type?.value,
                  [g("material")]: (product as any).material || "",
                  ...variantOptions,
                }
                // Allow client-specific mutation
                if (typeof itemTransform === 'function') {
                  itemData = await itemTransform(itemData, {
                    product,
                    variant,
                    availability,
                    regionId: selectedRegionId,
                    currencyCode: selectedCurrencyCode,
                  })
                }
                // Field filtering
                if (Array.isArray(includeFields) && includeFields.length) {
                  itemData = Object.fromEntries(
                    Object.entries(itemData).filter(([k]) => includeFields.includes(k))
                  )
                }
                if (Array.isArray(excludeFields) && excludeFields.length) {
                  excludeFields.forEach((f) => delete itemData[f])
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
              const thumbnail = product?.thumbnail
              const rawImages: (string | undefined)[] = [
                product?.images?.[0]?.url,
                product?.images?.[1]?.url,
                product?.images?.[2]?.url,
              ]
              const additionalImages: string[] = []
              for (const url of rawImages) {
                if (!url) continue
                if (url === thumbnail) continue
                if (additionalImages.includes(url)) continue
                additionalImages.push(url)
              }
              let item: any = {
                id: variant.id,
                itemgroup_id: product.id,
                title: product.title,
                description: product.description,
                link: `${store_url}/${product.handle}?${linkableOptions}`,
                image_link: thumbnail,
                additional_image_1: additionalImages[0],
                additional_image_2: additionalImages[1],
                brand: brand,
                price: defaultPrice,
                sale_price: salesPrice,
                availability,
                mpn: variant.sku,
                product_type: (product as any).type?.value,
                material: (product as any).material || "",
                ...variantOptions,
              }
              if (typeof itemTransform === 'function') {
                item = await itemTransform(item, {
                  product,
                  variant,
                  availability,
                  regionId: selectedRegionId,
                  currencyCode: selectedCurrencyCode,
                })
              }
              if (Array.isArray(includeFields) && includeFields.length) {
                item = Object.fromEntries(
                  Object.entries(item).filter(([k]) => includeFields.includes(k))
                )
              }
              if (Array.isArray(excludeFields) && excludeFields.length) {
                excludeFields.forEach((f) => delete item[f])
              }
              // strip empty values
              Object.keys(item).forEach((key) => {
                if (
                  item[key] === null ||
                  item[key] === undefined ||
                  item[key] === ""
                ) {
                  delete item[key]
                }
              })
              return item
            })
        })
      )

      mappedVariants = mappedVariants.concat(batchMapped)
    }

    return mappedVariants
  }
}
