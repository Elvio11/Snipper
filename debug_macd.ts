import { macd } from 'indicatorts'

const prices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
const result = macd(prices, 12, 26, 9)
console.log('Keys:', Object.keys(result))
console.log('Result:', JSON.stringify(result, null, 2))
