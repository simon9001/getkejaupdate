import { propertiesService } from './Properties/properties.service.js';
import { logger } from './utils/logger.js';
async function test() {
    try {
        console.log('Testing getUnverifiedProperties...');
        const properties = await propertiesService.getUnverifiedProperties();
        console.log('Success!', properties.length, 'properties found');
    }
    catch (error) {
        console.error('Error caught in test script:');
        console.error(error);
    }
}
test();
