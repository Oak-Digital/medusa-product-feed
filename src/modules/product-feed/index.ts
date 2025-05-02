import { Module } from '@medusajs/framework/utils';
import ProductFeedService from './service';
import './types/implementation';

export const PRODUCT_FEED_MODULE = 'ProductFeedModule';

export default Module(PRODUCT_FEED_MODULE, {
    service: ProductFeedService,
});
