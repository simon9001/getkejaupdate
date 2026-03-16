-- Migration to add missing admin columns to properties table
ALTER TABLE properties 
ADD COLUMN IF NOT EXISTS is_boosted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_struck BOOLEAN DEFAULT FALSE;

-- Optional: Add indexes for better performance on these flags
CREATE INDEX IF NOT EXISTS idx_properties_is_verified ON properties(is_verified);
CREATE INDEX IF NOT EXISTS idx_properties_is_boosted ON properties(is_boosted);
CREATE INDEX IF NOT EXISTS idx_properties_is_struck ON properties(is_struck);
