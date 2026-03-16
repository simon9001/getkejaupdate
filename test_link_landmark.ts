// Using native fetch

async function testLinkLandmark() {
    const url = 'http://localhost:8000/api/spatial/link-landmark';
    const payload = {
        propertyId: 'bd86dfd4-ed19-4385-9c09-41cb00aaf10c',
        landmark: {
            name: 'Test Hospital',
            lat: -1.286389,
            lon: 36.817223,
            type: 'hospital'
        }
    };

    console.log('Testing link-landmark with payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('Status:', response.status);
        const data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Fetch failed:', error);
    }
}

testLinkLandmark();
