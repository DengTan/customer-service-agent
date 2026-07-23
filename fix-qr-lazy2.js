#!/usr/bin/env node
// Fix 2: move state declarations out of function params into function body

const fs = require('fs');

const text = fs.readFileSync(
  'd:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx',
  'utf8'
);
const lines = text.split('\n');

// The wrongly-placed state declarations (inside function params)
const wronglyPlaced = [
  "  const [search, setSearch] = useState('');",
  "  const [categoryFilter, setCategoryFilter] = useState('all');",
  "  const [scopeFilter, setScopeFilter] = useState('all');",
  "  const [dialogOpen, setDialogOpen] = useState(false);",
  "  const [editingId, setEditingId] = useState<string | null>(null);",
  "  const [deletingId, setDeletingId] = useState<string | null>(null);",
  "  const [saving, setSaving] = useState(false);",
  "  const [importDialogOpen, setImportDialogOpen] = useState(false);",
  "  const [importing, setImporting] = useState(false);",
  "  const [copiedId, setCopiedId] = useState<string | null>(null);",
  "  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);",
  "  const [form, setForm] = useState({",
  "    title: '',",
  "    content: '',",
  "    category: '其他',",
  "    scope: 'global',",
  "  });",
];

// Find "  className," - the last param line that needs to close the destructuring
const classNameIdx = lines.findIndex(l => l.trim() === "className,");
if (classNameIdx === -1) { console.error('className, not found'); process.exit(1); }
console.log('className, at line', classNameIdx + 1);

// Find the wrongly placed state (first wrongly placed line)
const firstWrongIdx = lines.findIndex((l, i) => i > classNameIdx && wronglyPlaced.some(wp => l.trim() === wp.trim()));
if (firstWrongIdx === -1) { console.error('wrongly placed state not found'); process.exit(1); }
console.log('first wrong at line', firstWrongIdx + 1);

// Replace: "className," + wrongly placed lines -> "className," + "}" + state + ""
// i.e. close the params, start the body, insert state
const result = [
  ...lines.slice(0, classNameIdx + 1),          // up to and including className,
  '  }',                                         // close params destructuring
  '  {',                                         // open function body
  ...wronglyPlaced,                             // state declarations
  '',                                            // blank separator
  ...lines.slice(firstWrongIdx + wronglyPlaced.length), // rest of file
];

fs.writeFileSync(
  'd:/customer_service_agent-main/src/components/quick-replies/quick-replies-panel.tsx',
  '\ufeff' + result.join('\n'),
  'utf8'
);
console.log('Done. Total lines:', result.length);
