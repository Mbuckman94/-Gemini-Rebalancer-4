export interface Position {
    id: string;
    symbol: string;
    description: string;
    quantity: number;
    price: number;
    currentValue: number;
    costBasis: number;
    yield?: number;
    targetPct: number;
    roundingMode?: string;
    metadata?: any;
    unrealizedGL?: number;
    unrealizedGLPct?: number;
}

export interface Account {
    id: string;
    accountNumber: string;
    name: string;
    positions: Position[];
    isMoneyMarket: boolean;
    lastUpdated: string;
}

export interface Client {
    id: string;
    name: string;
    accounts: Account[];
    lastUpdated: string;
    profile?: {
        accountNumber?: string;
        firstName?: string;
        lastName?: string;
    };
}

const CASH_TICKERS = ["FDRXX", "FCASH", "SPAXX", "CASH", "MMDA", "USD", "CORE", "FZFXX", "SWVXX"];

const generateId = () => Math.random().toString(36).substr(2, 9);

const isBond = (symbol: string, description: string) => {
    if (!description) return false;
    const bondPattern = /\d+\.?\d*%\s+\d{2}\/\d{2}\/\d{4}/;
    const isCusip = symbol && symbol.length === 9 && /^[0-9A-Z]+$/.test(symbol);
    const hasBondKeywords = description.includes(" BDS ") || description.includes(" NOTE ") || description.includes(" CORP ") || description.includes(" MUNI ");
    return bondPattern.test(description) || (isCusip && hasBondKeywords);
};

export const parseFidelityCSV = (text: string): Position[] => {
    const lines = text.split(/\r?\n/);
    let startIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("Security ID") && lines[i].includes("Quantity")) {
            startIndex = i;
            break;
        }
    }
    if (startIndex === -1) return [];

    const headers = lines[startIndex].split(',').map(h => h.trim());
    const symIdx = headers.findIndex(h => h.includes("Security ID"));
    const qtyIdx = headers.findIndex(h => h.includes("Quantity"));
    const descIdx = headers.findIndex(h => h.includes("Security Description"));
    const priceIdx = headers.findIndex(h => h.includes("Last Price") || h.includes("Price") || h.includes("Close"));
    const costBasisIdx = headers.findIndex(h => h === "Cost" || h.includes("Cost Basis"));

    const parseLine = (line: string) => {
        const row = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        return row;
    };

    const results: Position[] = [];
    for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const row = parseLine(line);
        if (row.length <= Math.max(symIdx, qtyIdx)) continue;
        const symbol = row[symIdx];
        if (!symbol || symbol === "Pending") continue;
        let qtyStr = row[qtyIdx].replace(/[",]/g, '');
        const quantity = parseFloat(qtyStr);
        if (isNaN(quantity)) continue;
        const desc = descIdx > -1 ? row[descIdx].replace(/^"|"$/g, '') : "";
        const isCash = CASH_TICKERS.some(t => symbol.includes(t)) || desc.toUpperCase().includes("CASH");
        const isFixedIncome = isBond(symbol, desc);
        
        let price = isCash ? 1.0 : 0;
        if (priceIdx > -1 && row[priceIdx]) {
            const pStr = row[priceIdx].replace(/[$,]/g, '');
            const pVal = parseFloat(pStr);
            if (!isNaN(pVal)) price = pVal;
        }

        let val = quantity * price;
        let extractedYield = 0;

        if (isFixedIncome) {
            val = (quantity * price) / 100;
            const yieldMatch = desc.match(/(\d+\.?\d*)%/);
            if (yieldMatch) {
                extractedYield = parseFloat(yieldMatch[1]);
            }
        }

        let costBasis = val; // Default to current value if missing
        if (costBasisIdx > -1 && row[costBasisIdx]) {
            const cbStr = row[costBasisIdx].replace(/[$,]/g, '');
            const cbVal = parseFloat(cbStr);
            if (!isNaN(cbVal)) costBasis = cbVal;
        }

        results.push({
            id: generateId(),
            symbol: symbol,
            description: desc,
            quantity: quantity,
            price: price,
            currentValue: val,
            costBasis: costBasis,
            yield: extractedYield, 
            targetPct: 0,
            roundingMode: 'exact',
            metadata: isFixedIncome ? { assetClass: 'Fixed Income' } : null
        });
    }
    return results;
};

export const parseMassImportCSV = (text: string): Client[] => {
    const lines = text.split(/\r?\n/);
    let headerIndex = -1;
    
    // Find header row
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("Primary Account Holder") && line.includes("Account #") && line.includes("Symbol")) {
            headerIndex = i;
            break;
        }
    }

    if (headerIndex === -1) return [];

    const headers = lines[headerIndex].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    const getIdx = (name: string) => headers.findIndex(h => h.includes(name));
    
    const clientIdx = getIdx("Primary Account Holder");
    const accountNumIdx = getIdx("Account #");
    const accountNameIdx = getIdx("FBSI Short Name");
    const symbolIdx = getIdx("Symbol");
    const secIdIdx = getIdx("Security ID");
    const descIdx = getIdx("Description");
    const qtyIdx = getIdx("Trade Date Quantity");
    const priceIdx = getIdx("Market Price");
    const valIdx = getIdx("Market Value");
    const adjCostIdx = headers.findIndex(h => h === "Adjusted Cost Basis Amnt");
    const exactCostIdx = headers.findIndex(h => h === "Cost");
    const costIdx = adjCostIdx > -1 ? adjCostIdx : exactCostIdx;

    const clientMap = new Map<string, Client>();

    const parseLine = (line: string) => {
        const row = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        return row;
    };

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const row = parseLine(line);
        if (row.length < headers.length) continue;

        const clientName = row[clientIdx]?.replace(/^"|"$/g, '') || "Unknown Client";
        const accountNum = row[accountNumIdx]?.replace(/^"|"$/g, '') || "Unknown Account";
        const accountName = row[accountNameIdx]?.replace(/^"|"$/g, '') || accountNum;
        
        if (!clientMap.has(clientName)) {
            const nameParts = clientName.includes(',') 
                ? clientName.split(',').map(p => p.trim()) 
                : clientName.split(' ').map(p => p.trim());
            
            const lastName = clientName.includes(',') ? nameParts[0] : (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '');
            const firstName = clientName.includes(',') ? nameParts[1] : (nameParts.length > 1 ? nameParts[0] : nameParts[0]);

            clientMap.set(clientName, {
                id: generateId(),
                name: clientName,
                accounts: [],
                lastUpdated: new Date().toISOString(),
                profile: { 
                    accountNumber: accountNum,
                    firstName: firstName || '',
                    lastName: lastName || ''
                }
            });
        }
        
        const client = clientMap.get(clientName)!;
        let account = client.accounts.find(a => a.accountNumber === accountNum);
        
        if (!account) {
            account = {
                id: generateId(),
                accountNumber: accountNum,
                name: accountName,
                positions: [],
                isMoneyMarket: false,
                lastUpdated: new Date().toISOString()
            };
            client.accounts.push(account);
        }

        // Position Parsing
        let symbol = row[symbolIdx]?.replace(/^"|"$/g, '');
        const secId = row[secIdIdx]?.replace(/^"|"$/g, '');
        if (!symbol) symbol = secId;
        
        if (!symbol) continue;

        const cleanNum = (val: string) => {
            if (!val) return 0;
            return parseFloat(val.replace(/[$,"]/g, '')) || 0;
        };

        const quantity = cleanNum(row[qtyIdx]);
        let price = cleanNum(row[priceIdx]);
        const marketValue = cleanNum(row[valIdx]);
        let costBasis = cleanNum(row[costIdx]);
        const description = row[descIdx]?.replace(/^"|"$/g, '') || "";

        const isCash = CASH_TICKERS.some(t => symbol.includes(t)) || description.toUpperCase().includes("CASH");
        
        if (isCash) price = 1.0;
        
        if (costBasis === 0) costBasis = marketValue; // Default cost to value if missing

        const unrealizedGL = marketValue - costBasis;
        const unrealizedGLPct = costBasis > 0 ? (unrealizedGL / costBasis) : 0;
        
        const isFixedIncome = isBond(symbol, description);

        let extractedYield = 0;
        if (isFixedIncome) {
            const yieldMatch = description.match(/(\d+\.?\d*)%/);
            if (yieldMatch) {
                extractedYield = parseFloat(yieldMatch[1]);
            }
        }

        account.positions.push({
            id: generateId(),
            symbol: symbol,
            description: description,
            quantity: quantity,
            price: price,
            currentValue: marketValue,
            costBasis: costBasis,
            unrealizedGL: unrealizedGL,
            unrealizedGLPct: unrealizedGLPct,
            yield: extractedYield, 
            targetPct: 0,
            metadata: isFixedIncome ? { assetClass: 'Fixed Income' } : isCash ? { assetClass: 'Cash' } : null
        });
    }

    return Array.from(clientMap.values());
};
