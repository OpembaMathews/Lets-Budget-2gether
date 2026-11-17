// Countries and the currency each one uses, for the set-up guide.
// Taiwan's dollar is shown as NTD, the name people there use; banks write TWD.

const LIST = `Afghanistan|AFN
Albania|ALL
Algeria|DZD
Angola|AOA
Argentina|ARS
Armenia|AMD
Australia|AUD
Austria|EUR
Azerbaijan|AZN
Bahamas|BSD
Bahrain|BHD
Bangladesh|BDT
Barbados|BBD
Belarus|BYN
Belgium|EUR
Belize|BZD
Benin|XOF
Bhutan|BTN
Bolivia|BOB
Bosnia and Herzegovina|BAM
Botswana|BWP
Brazil|BRL
Brunei|BND
Bulgaria|BGN
Burkina Faso|XOF
Burundi|BIF
Cambodia|KHR
Cameroon|XAF
Canada|CAD
Cape Verde|CVE
Central African Republic|XAF
Chad|XAF
Chile|CLP
China|CNY
Colombia|COP
Comoros|KMF
Congo (Brazzaville)|XAF
Congo (DRC)|CDF
Costa Rica|CRC
Croatia|EUR
Cuba|CUP
Cyprus|EUR
Czechia|CZK
Denmark|DKK
Djibouti|DJF
Dominican Republic|DOP
Ecuador|USD
Egypt|EGP
El Salvador|USD
Equatorial Guinea|XAF
Eritrea|ERN
Estonia|EUR
Eswatini|SZL
Ethiopia|ETB
Fiji|FJD
Finland|EUR
France|EUR
Gabon|XAF
Gambia|GMD
Georgia|GEL
Germany|EUR
Ghana|GHS
Greece|EUR
Guatemala|GTQ
Guinea|GNF
Guinea-Bissau|XOF
Guyana|GYD
Haiti|HTG
Honduras|HNL
Hong Kong|HKD
Hungary|HUF
Iceland|ISK
India|INR
Indonesia|IDR
Iran|IRR
Iraq|IQD
Ireland|EUR
Israel|ILS
Italy|EUR
Ivory Coast|XOF
Jamaica|JMD
Japan|JPY
Jordan|JOD
Kazakhstan|KZT
Kenya|KES
Kuwait|KWD
Kyrgyzstan|KGS
Laos|LAK
Latvia|EUR
Lebanon|LBP
Lesotho|LSL
Liberia|LRD
Libya|LYD
Lithuania|EUR
Luxembourg|EUR
Macau|MOP
Madagascar|MGA
Malawi|MWK
Malaysia|MYR
Maldives|MVR
Mali|XOF
Malta|EUR
Mauritania|MRU
Mauritius|MUR
Mexico|MXN
Moldova|MDL
Mongolia|MNT
Montenegro|EUR
Morocco|MAD
Mozambique|MZN
Myanmar|MMK
Namibia|NAD
Nepal|NPR
Netherlands|EUR
New Zealand|NZD
Nicaragua|NIO
Niger|XOF
Nigeria|NGN
North Macedonia|MKD
Norway|NOK
Oman|OMR
Pakistan|PKR
Panama|PAB
Papua New Guinea|PGK
Paraguay|PYG
Peru|PEN
Philippines|PHP
Poland|PLN
Portugal|EUR
Qatar|QAR
Romania|RON
Russia|RUB
Rwanda|RWF
Saudi Arabia|SAR
Senegal|XOF
Serbia|RSD
Seychelles|SCR
Sierra Leone|SLE
Singapore|SGD
Slovakia|EUR
Slovenia|EUR
Somalia|SOS
South Africa|ZAR
South Korea|KRW
South Sudan|SSP
Spain|EUR
Sri Lanka|LKR
Sudan|SDG
Suriname|SRD
Sweden|SEK
Switzerland|CHF
Syria|SYP
Taiwan|NTD
Tajikistan|TJS
Tanzania|TZS
Thailand|THB
Togo|XOF
Trinidad and Tobago|TTD
Tunisia|TND
Turkey|TRY
Turkmenistan|TMT
Uganda|UGX
Ukraine|UAH
United Arab Emirates|AED
United Kingdom|GBP
United States|USD
Uruguay|UYU
Uzbekistan|UZS
Venezuela|VES
Vietnam|VND
Yemen|YER
Zambia|ZMW
Zimbabwe|ZWG`

export const COUNTRIES: { name: string; currency: string }[] = LIST.split('\n').map((row) => {
  const [name, currency] = row.split('|')
  return { name, currency }
})

export function currencyOf(country: string): string | undefined {
  return COUNTRIES.find((c) => c.name === country)?.currency
}
