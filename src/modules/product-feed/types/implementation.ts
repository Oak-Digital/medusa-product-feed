import { PRODUCT_FEED_MODULE } from "..";
import type ProductFeedService from "../service";

declare module '@medusajs/framework/types' {
    interface ModuleImplementations {
        [PRODUCT_FEED_MODULE]: ProductFeedService;
    }
}
