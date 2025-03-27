## Features

- Exposes a `GET /feed/products` API endpoint.
- Generates a product feed containing detailed product and variant information.
- Includes calculated prices based on region and currency code (supports `?currency=<CURRENCY_CODE>` query parameter).
- Fetches and includes inventory availability per sales channel.
- Maps product data (title, description, handle, image, material, type) and variant data (SKU, options, price, sale price) to a feed-friendly format.
- Efficiently handles large product catalogs using batch processing.

## Compatibility

This plugin is compatible with Medusa V2, specifically versions >= 2.4.0 of `@medusajs/medusa`.

## Prerequisites

- A working Medusa V2 backend.

## How to Install

1.  Install the plugin in your Medusa project:
    ```bash
    yarn add @oak-digital/product-feed
    ```
    *(Replace `@oak-digital/product-feed` with the actual published package name)*

2.  Add the plugin to your `medusa-config.js`:

```javascript
   plugins: [
    {
      resolve: "@oak-digital/product-feed",
      options: {},
    },
  ],
    ```

## Test the Plugin

1.  Start your Medusa backend:
    ```bash
    medusa develop
    ```
    or if you have a custom start script:
    ```bash
    yarn start
    ```

2.  Access the feed endpoint in your browser or using a tool like `curl`:
    `http://localhost:9000/feed/products`

3.  To get the feed for a specific currency (if regions are configured), append the currency code:
    `http://localhost:9000/feed/products?currency=USD`


