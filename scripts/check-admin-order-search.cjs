const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/app/admin/orders/page.tsx','utf8');
assert(source.includes("const [search,setSearch]=useState('')"),'orders search needs a debounced server-load term');
assert(source.includes('orders?page=1&limit=1000'),'orders page must load the full set before paid-order filtering');
assert(source.includes('filteredRows.slice((page-1)*25,page*25)'),'paid orders must be paginated after filtering');
assert(source.includes('Math.ceil(filteredRows.length/25)'),'total pages must come from filtered paid orders');
assert(source.includes("search?`${filteredRows.length} matching orders"),'search footer must show matching rows');
assert(source.includes('.includes(search.toLowerCase())'),'row filter must use the debounced search term');
console.log('admin global order search check passed');
