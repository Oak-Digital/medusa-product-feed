## @oak-digital/product-feed

Product feed plugin for Medusa v2 that exposes ready-to-consume JSON and Google Merchant–compatible XML feeds with region-aware pricing and inventory availability.

## Features

- `GET /feed/products`: JSON product feed (variants as items).
- `GET /feed/products-xml`: Google Merchant XML feed (RSS 2.0 + g namespace).
- Region-aware pricing via `?country_code=` or `?currency=`.
- Inventory availability per sales channel (in stock / out of stock).
- Maps product fields (title, description, handle, images, material, type) and variant fields (SKU, options, price/sale price).
- Handles large catalogs using batch processing.

## Compatibility

- Medusa v2 (tested with `@medusajs/framework` 2.7.x). Should work with Medusa v2 projects using Regions, Products, and Sales Channels.

## Prerequisites

- A running Medusa v2 backend with at least one Region configured.
- Products and Variants with prices (region/currency) and SKUs.

## Installation

1) Install the package in your Medusa project

```bash
yarn add @oak-digital/product-feed
```

2) Register the plugin in your `medusa-config.(ts|js)`

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ...
  plugins: [
    {
      resolve: "@oak-digital/product-feed",
      options: {
        // Optional — used for link generation and XML channel metadata
        title: "Product Feed",
        link: "https://yourstore.com",
        description: "A feed of products from our store",
        brand: "Your Brand",
      },
    },
  ],
})
```

If you omit `options`, sensible defaults are used. The `link` is used as the base URL for item links: `${link}/${product.handle}` with selected variant options added as query parameters.

## Endpoints

- JSON: `GET /feed/products`
- XML: `GET /feed/products-xml`

Both endpoints are public by default (no auth middleware). Adjust as needed in your app if you require protection.

### Query parameters

- `country_code`: Two/three-letter country code used to pick a Region (e.g., `DK`, `US`, `de`). If provided and matched, it takes precedence over `currency`.
- `currency`: Currency code used to pick a Region (e.g., `USD`, `EUR`).

If neither is provided, the first configured Region is used.

### Examples

```bash
# JSON feed using default region
curl http://localhost:9000/feed/products

# JSON feed for a specific currency
curl "http://localhost:9000/feed/products?currency=USD"

# XML feed for a specific country
curl "http://localhost:9000/feed/products-xml?country_code=DK"
```

## Response shape

### JSON item (per variant)

```json
{
  "id": "variant_123",
  "itemgroup_id": "prod_123",
  "title": "Product Title",
  "description": "Product description...",
  "link": "https://yourstore.com/product-handle?size=M&color=Red",
  "image_link": "https://.../thumbnail.jpg",
  "addtional_image_1": "https://.../image1.jpg",
  "addtional_image_2": "https://.../image2.jpg",
  "brand": "Your Brand",
  "price": "12000 USD",
  "sale_price": "9900 USD",
  "availability": 5,
  "mpn": "SKU-123",
  "product_type": "Clothing",
  "material": "Cotton",
  "size": "M",
  "color": "Red"
}
```

Notes:
- Options named "Default" are ignored.
- Only variants with calculated prices are included.
- `availability` is a numeric quantity derived per sales channel. The XML feed converts it to `in stock` / `out of stock`.

### XML item (Google Merchant)

Each variant becomes an `<item>` with `g:`-namespaced fields under an RSS 2.0 `<channel>`. Example (truncated):

```xml
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Product Feed</title>
    <link>https://yourstore.com</link>
    <description>A feed of products from our store</description>
    <item>
      <g:id>variant_123</g:id>
      <g:item_group_id>prod_123</g:item_group_id>
      <g:title>Product Title</g:title>
      <g:description>Product description...</g:description>
      <g:link>https://yourstore.com/product-handle?size=M&amp;color=Red</g:link>
      <g:image_link>https://.../thumbnail.jpg</g:image_link>
      <g:brand>Your Brand</g:brand>
      <g:condition>new</g:condition>
      <g:availability>in stock</g:availability>
      <g:price>12000 USD</g:price>
      <g:sale_price>9900 USD</g:sale_price>
      <g:mpn>SKU-123</g:mpn>
      <g:product_type>Clothing</g:product_type>
      <g:material>Cotton</g:material>
      <!-- Variant options are emitted as g:<sanitized_option_title> -->
      <g:size>M</g:size>
      <g:color>Red</g:color>
    </item>
  </channel>
</rss>
```

Option titles are sanitized for XML: lowercased, spaces/special characters replaced with `_`, and Danish characters converted (`æ`→`ae`, `ø`→`oe`, `å`→`aa`).

## How it works

- Selects a Region using `country_code` or `currency` and computes variant prices for that Region.
- Batches products (default 50 per batch) and computes variant availability per sales channel.
- Emits one item per variant. Links include variant options as query parameters for deep-linking.

## Customization

Basic feed metadata can be customized via plugin `options` in `medusa-config`:

- `title`: Feed title used in XML `<channel><title>`.
- `link`: Store base URL used to build item links.
- `description`: Feed description used in XML.
- `brand`: Default brand if you don’t have product type–based brands.

Advanced shape changes (adding/removing fields, custom logic) can be done by extending or forking the plugin and using the `ProductFeedService`’s internal hooks (`itemTransform`, `includeFields`, `excludeFields`) inside your own route. Open an issue if you’d like these exposed as configuration.

## Troubleshooting

- No regions found: ensure at least one Region exists in your Medusa project.
- Empty prices: verify variants have prices for the selected Region/currency.
- Missing availability: ensure products are assigned to a Sales Channel and inventory is configured.

## License

MIT
