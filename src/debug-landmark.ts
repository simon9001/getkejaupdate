import './config/environment.js';
import { spatialService } from './services/spatial.service.js';
import { logger } from './utils/logger.js';

async function testLinkLandmark() {
    const propertyId = 'cc3c5911-c57d-46d9-b6ac-40cd12def23f'; // From user log
    const landmark = {
        name: 'Test Landmark',
        type: 'School',
        lat: -1.2581,
        lon: 36.8041
    };

    console.log('Testing linkLandmark with:', { propertyId, landmark });

    try {
        const result = await spatialService.linkLandmark(propertyId, landmark);
        console.log('Success:', result);
    } catch (error: any) {
        console.error('FAILED:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
    }
}

testLinkLandmark().then(() => process.exit(0));
