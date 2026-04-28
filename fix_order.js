import fs from 'fs';

const filePath = 'src/components/shockwave/ShockwaveView.jsx';
let content = fs.readFileSync(filePath, 'utf-8');

// Find normalizeKeysToMergeMasters block
const regex = /const normalizeKeysToMergeMasters = useCallback\(\(keys\) => \{[\s\S]*?\}, \[normalizeCellToMergeMaster, cellKey\]\);\s*/;
const match = content.match(regex);
if (match) {
  const block = match[0];
  // Remove it from its current position
  content = content.replace(block, '');
  
  // Find normalizeCellToMergeMaster block end
  const targetRegex = /(const normalizeCellToMergeMaster = useCallback\(\(cell\) => \{[\s\S]*?\}, \[cellKey, getEffectiveMergeSpan\]\);\s*)/;
  content = content.replace(targetRegex, `$1\n  ${block.trim()}\n\n`);
  
  fs.writeFileSync(filePath, content);
  console.log("Fixed order!");
} else {
  console.log("Could not find normalizeKeysToMergeMasters block");
}
