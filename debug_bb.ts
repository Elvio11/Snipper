import { bb } from 'indicatorts'

const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
const result = bb(prices, 5, 2)
console.log('BB Keys:', Object.keys(result))
console.log('BB Result:', JSON.stringify(result, null, 2))
