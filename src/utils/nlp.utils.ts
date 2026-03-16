import type { ParsedQuery, PropertyCategory } from '../types/property.types.js';

/**
 * Parse natural language queries like:
 * "i want a house around embu university ranging 2500"
 * "2 bedroom apartment in Nairobi under 50000"
 * "commercial property near Kencom bus stop"
 */
export async function parseNaturalLanguageQuery(query: string): Promise<ParsedQuery> {
    const lowerQuery = query.toLowerCase().trim();
    const parsed: ParsedQuery = {
        text: query
    };

    // Extract price ranges with comprehensive patterns
    const pricePatterns = [
        // Under/below patterns
        { pattern: /(?:under|below|less than|max|≤|<=|not more than|at most)\s*(?:kes|ksh|k)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i, type: 'max' },
        // Above/over patterns
        { pattern: /(?:above|over|more than|min|≥|>=|at least|not less than)\s*(?:kes|ksh|k)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i, type: 'min' },
        // Range patterns
        { pattern: /(?:ranging|between|from)\s*(?:kes|ksh|k)?\s*(\d+(?:,\d+)?(?:\.\d+)?)\s*(?:to|-|and|upto|up to)\s*(?:kes|ksh|k)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i, type: 'range' },
        // Around/approx patterns
        { pattern: /(?:around|about|approx|≈|near)\s*(?:kes|ksh|k)?\s*(\d+(?:,\d+)?(?:\.\d+)?)/i, type: 'approx' },
        // Simple number at end (e.g., "house 2500")
        { pattern: /(\d+(?:,\d+)?(?:\.\d+)?)\s*$/, type: 'approx' }
    ];

    for (const { pattern, type } of pricePatterns) {
        const match = lowerQuery.match(pattern);
        if (match) {
            if (type === 'max' && match[1]) {
                parsed.maxPrice = parseFloat(match[1].replace(/,/g, ''));
                break;
            } else if (type === 'min' && match[1]) {
                parsed.minPrice = parseFloat(match[1].replace(/,/g, ''));
                break;
            } else if (type === 'range' && match[1] && match[2]) {
                parsed.minPrice = parseFloat(match[1].replace(/,/g, ''));
                parsed.maxPrice = parseFloat(match[2].replace(/,/g, ''));
                break;
            } else if (type === 'approx' && match[1]) {
                const price = parseFloat(match[1].replace(/,/g, ''));
                parsed.maxPrice = price * 1.2; // 20% above
                parsed.minPrice = price * 0.8; // 20% below
                break;
            }
        }
    }

    // Extract bedroom count with comprehensive patterns
    const bedroomPatterns = [
        /(\d+)\s*(?:bedroom|bed|bed rooms?|beds?|br|brm)/i,
        /(?:one|1)\s*(?:bedroom|bed)/i,
        /(?:two|2)\s*(?:bedroom|bed)/i,
        /(?:three|3)\s*(?:bedroom|bed)/i,
        /(?:four|4)\s*(?:bedroom|bed)/i,
        /(?:studio|bedsitter|single room)/i
    ];

    for (const pattern of bedroomPatterns) {
        const match = lowerQuery.match(pattern);
        if (match) {
            if (match[1] && !isNaN(parseInt(match[1]))) {
                parsed.bedrooms = parseInt(match[1]);
            } else if (match[0].includes('one') || match[0].includes('1')) {
                parsed.bedrooms = 1;
            } else if (match[0].includes('two') || match[0].includes('2')) {
                parsed.bedrooms = 2;
            } else if (match[0].includes('three') || match[0].includes('3')) {
                parsed.bedrooms = 3;
            } else if (match[0].includes('four') || match[0].includes('4')) {
                parsed.bedrooms = 4;
            } else if (match[0].includes('studio') || match[0].includes('bedsitter') || match[0].includes('single room')) {
                parsed.bedrooms = 0;
                parsed.propertyType = match[0].includes('studio') ? 'studio' : 'bedsitter';
            }
            break;
        }
    }

    // Extract property type with comprehensive mapping
    const propertyTypeMap: Record<string, string> = {
        'apartment': 'apartment',
        'apt': 'apartment',
        'flat': 'apartment',
        'house': 'maisonette',
        'bungalow': 'bungalow',
        'villa': 'villa',
        'mansion': 'villa',
        'studio': 'studio',
        'bedsitter': 'bedsitter',
        'bed sitter': 'bedsitter',
        'office': 'office',
        'shop': 'retail',
        'store': 'retail',
        'warehouse': 'warehouse',
        'godown': 'warehouse',
        'industrial': 'industrial',
        'factory': 'industrial',
        'short stay': 'short_term',
        'airbnb': 'short_term',
        'vacation': 'vacation',
        'holiday': 'vacation',
        'resort': 'resort',
        'camp': 'camp',
        'guest house': 'short_term'
    };

    for (const [key, value] of Object.entries(propertyTypeMap)) {
        if (lowerQuery.includes(key)) {
            parsed.propertyType = value;
            break;
        }
    }

    // Extract category
    if (lowerQuery.match(/\b(commercial|business|office|shop|store|warehouse|industrial|factory|retail)\b/)) {
        parsed.category = 'commercial';
    } else if (lowerQuery.match(/\b(residential|home|house|apartment|flat|bedroom|bedsitter|studio|villa|bungalow)\b/)) {
        parsed.category = 'residential';
    } else if (lowerQuery.match(/\b(recreational|holiday|vacation|resort|tourist|short stay|airbnb|camp|guest)\b/)) {
        parsed.category = 'recreational';
    }

    // Extract landmark with improved patterns
    const landmarkPatterns = [
        /(?:around|near|close to|by|beside|adjacent|next to|opposite)\s+([a-zA-Z\s]+?)(?:\s+(?:with|and|under|above|for|ranging|price|kes|ksh|bed|br|$))/i,
        /(?:at|in)\s+([a-zA-Z\s]+?)(?:\s+(?:area|neighborhood|estate|zone|location|$))/i,
        /(?:near)\s+([a-zA-Z\s]+?)(?:\s+(?:university|hospital|school|market|bus|road|mall|center|centre|$))/i
    ];

    for (const pattern of landmarkPatterns) {
        const match = lowerQuery.match(pattern);
        if (match && match[1]) {
            const potentialLandmark = match[1].trim();
            // Filter out common words and single characters
            if (potentialLandmark.length > 2 && 
                !['the', 'a', 'an', 'this', 'that', 'here', 'there'].includes(potentialLandmark)) {
                parsed.landmark = potentialLandmark;
                break;
            }
        }
    }

    // Extract town/city if no landmark found
    if (!parsed.landmark) {
        const townPatterns = [
            /in\s+([a-zA-Z\s]+?)(?:\s+(?:with|and|under|above|for|ranging|price|kes|ksh|$))/i,
            /at\s+([a-zA-Z\s]+?)(?:\s+(?:area|$))/i
        ];

        for (const pattern of townPatterns) {
            const match = lowerQuery.match(pattern);
            if (match && match[1]) {
                const potentialTown = match[1].trim();
                if (potentialTown.length > 2) {
                    parsed.town = potentialTown;
                    break;
                }
            }
        }
    }

    // Extract radius
    const radiusMatch = lowerQuery.match(/(\d+)\s*(?:m|meter|metre|km|kilometer|kms)/i);
    if (radiusMatch) {
        let radius = parseInt(radiusMatch[1]);
        if (radiusMatch[0].includes('km') || radiusMatch[0].includes('kilometer')) {
            radius *= 1000; // Convert km to meters
        }
        parsed.radius = radius;
    } else if (parsed.landmark || parsed.town) {
        parsed.radius = 2000; // Default 2km
    }

    return parsed;
}

/**
 * Extract keywords from query for full-text search
 */
export function extractKeywords(query: string): string[] {
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'around', 'near', 'close',
        'want', 'need', 'looking', 'find', 'search', 'property', 'house',
        'home', 'apartment', 'rent', 'buy', 'price', 'cost', 'budget'
    ]);

    return query.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word))
        .map(word => word.replace(/[^\w\s]/g, ''));
}