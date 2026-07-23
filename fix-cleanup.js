const fs = require('fs');
const text = fs.readFileSync('d:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx', 'utf8');
const fixed = text
  .replace("import { useState, useEffect, useMemo, useRef, useCallback } from \"react\";", "import { useState, useEffect, useMemo, useRef } from \"react\";")
  .replace("import { useState, useEffect, useMemo, useRef, useCallback }from \"react\";", "import { useState, useEffect, useMemo, useRef }from \"react\";");
if (fixed !== text) {
  fs.writeFileSync('d:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx', fixed);
  console.log('Removed useCallback');
} else {
  console.log('useCallback already gone or pattern not found');
}
