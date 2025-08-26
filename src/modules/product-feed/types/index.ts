import { CalculatedPriceSet, ProductDTO, ProductVariantDTO, SalesChannelDTO } from "@medusajs/types"

export type ExtendedVariantDTO = ProductVariantDTO & {
  calculated_price: CalculatedPriceSet
  availability: number
}

export type ExtendedProductDTO = ProductDTO & {
  variants: ExtendedVariantDTO[]
  sales_channels: SalesChannelDTO[]
}
