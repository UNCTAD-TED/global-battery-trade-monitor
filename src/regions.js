export const RegionConfig = {
    // UNCTAD 5 Major Regions + Global Definition
    regions: {
        "Global": { center: [0, 20], scale: 1 },
        "Africa": { center: [20, 0], scale: 2.5 },
        "Americas": { center: [-80, 10], scale: 1.8 }, // 北米・南米全体が見える中心位置
        "Asia": { center: [100, 30], scale: 2.0 },
        "Europe": { center: [15, 50], scale: 3.5 },
        "Oceania": { center: [140, -25], scale: 3.0 }
    },

    // ISO Alpha-3 to Region Mapping
    mapping: {
        // --- Africa ---
        "DZA": "Africa", "AGO": "Africa", "BEN": "Africa", "BWA": "Africa", "BFA": "Africa", "BDI": "Africa", 
        "CMR": "Africa", "CPV": "Africa", "CAF": "Africa", "TCD": "Africa", "COM": "Africa", "COG": "Africa", 
        "COD": "Africa", "CIV": "Africa", "DJI": "Africa", "EGY": "Africa", "GNQ": "Africa", "ERI": "Africa", 
        "ETH": "Africa", "GAB": "Africa", "GMB": "Africa", "GHA": "Africa", "GIN": "Africa", "GNB": "Africa", 
        "KEN": "Africa", "LSO": "Africa", "LBR": "Africa", "LBY": "Africa", "MDG": "Africa", "MWI": "Africa", 
        "MLI": "Africa", "MRT": "Africa", "MUS": "Africa", "MAR": "Africa", "MOZ": "Africa", "NAM": "Africa", 
        "NER": "Africa", "NGA": "Africa", "RWA": "Africa", "STP": "Africa", "SEN": "Africa", "SYC": "Africa", 
        "SLE": "Africa", "SOM": "Africa", "ZAF": "Africa", "SSD": "Africa", "SDN": "Africa", "SWZ": "Africa", 
        "TGO": "Africa", "TUN": "Africa", "UGA": "Africa", "TZA": "Africa", "ZMB": "Africa", "ZWE": "Africa",

        // --- Americas ---
        "ATG": "Americas", "ARG": "Americas", "BHS": "Americas", "BRB": "Americas", "BLZ": "Americas", 
        "BOL": "Americas", "BRA": "Americas", "CAN": "Americas", "CHL": "Americas", "COL": "Americas", 
        "CRI": "Americas", "CUB": "Americas", "DMA": "Americas", "DOM": "Americas", "ECU": "Americas", 
        "SLV": "Americas", "GRD": "Americas", "GTM": "Americas", "GUY": "Americas", "HTI": "Americas", 
        "HND": "Americas", "JAM": "Americas", "MEX": "Americas", "NIC": "Americas", "PAN": "Americas", 
        "PRY": "Americas", "PER": "Americas", "KNA": "Americas", "LCA": "Americas", "VCT": "Americas", 
        "SUR": "Americas", "TTO": "Americas", "USA": "Americas", "URY": "Americas", "VEN": "Americas",

        // --- Asia (Middle East included) ---
        "AFG": "Asia", "ARM": "Asia", "AZE": "Asia", "BHR": "Asia", "BGD": "Asia", "BTN": "Asia", 
        "BRN": "Asia", "KHM": "Asia", "CHN": "Asia", "CYP": "Asia", "GEO": "Asia", "HKG": "Asia", 
        "IND": "Asia", "IDN": "Asia", "IRN": "Asia", "IRQ": "Asia", "ISR": "Asia", "JPN": "Asia", 
        "JOR": "Asia", "KAZ": "Asia", "KWT": "Asia", "KGZ": "Asia", "LAO": "Asia", "LBN": "Asia", 
        "MAC": "Asia", "MYS": "Asia", "MDV": "Asia", "MNG": "Asia", "MMR": "Asia", "NPL": "Asia", 
        "PRK": "Asia", "OMN": "Asia", "PAK": "Asia", "PHL": "Asia", "QAT": "Asia", "KOR": "Asia", 
        "SAU": "Asia", "SGP": "Asia", "LKA": "Asia", "SYR": "Asia", "TWN": "Asia", "TJK": "Asia", 
        "THA": "Asia", "TLS": "Asia", "TUR": "Asia", "TKM": "Asia", "ARE": "Asia", "UZB": "Asia", 
        "VNM": "Asia", "YEM": "Asia",

        // --- Europe ---
        "ALB": "Europe", "AND": "Europe", "AUT": "Europe", "BLR": "Europe", "BEL": "Europe", "BIH": "Europe", 
        "BGR": "Europe", "HRV": "Europe", "CZE": "Europe", "DNK": "Europe", "EST": "Europe", "FIN": "Europe", 
        "FRA": "Europe", "DEU": "Europe", "GRC": "Europe", "HUN": "Europe", "ISL": "Europe", "IRL": "Europe", 
        "ITA": "Europe", "LVA": "Europe", "LIE": "Europe", "LTU": "Europe", "LUX": "Europe", "MLT": "Europe", 
        "MDA": "Europe", "MCO": "Europe", "MNE": "Europe", "NLD": "Europe", "MKD": "Europe", "NOR": "Europe", 
        "POL": "Europe", "PRT": "Europe", "ROU": "Europe", "RUS": "Europe", "SMR": "Europe", "SRB": "Europe", 
        "SVK": "Europe", "SVN": "Europe", "ESP": "Europe", "SWE": "Europe", "CHE": "Europe", "UKR": "Europe", 
        "GBR": "Europe", "VAT": "Europe",

        // --- Oceania ---
        "AUS": "Oceania", "FJI": "Oceania", "KIR": "Oceania", "MHL": "Oceania", "FSM": "Oceania", 
        "NRU": "Oceania", "NZL": "Oceania", "PLW": "Oceania", "PNG": "Oceania", "WSM": "Oceania", 
        "SLB": "Oceania", "TON": "Oceania", "TUV": "Oceania", "VUT": "Oceania"
    },

    getRegion(isoCode) {
        return this.mapping[isoCode] || "Other";
    }
};