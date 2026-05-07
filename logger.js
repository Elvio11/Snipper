import winston from 'winston';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { broadcast } from './dashboard-api.js';

let dailyRotateAvailable = false;
try {
  require.resolve('winston-daily-rotate-file');
  dailyRotateAvailable = true;
} catch (e) {
  dailyRotateAvailable = false;
}

if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

let transports = [];

if (dailyRotateAvailable) {
  const DailyRotateFile = require('winston-daily-rotate-file');
  
  transports = [
    new DailyRotateFile({
      filename: path.join('./logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: 7,
      maxSize: '10m',
      format: fileFormat,
    }),
    new DailyRotateFile({
      filename: path.join('./logs', 'trades-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: 7,
      maxSize: '10m',
      format: fileFormat,
    }),
    new DailyRotateFile({
      filename: path.join('./logs', 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: 7,
      maxSize: '10m',
      format: fileFormat,
    }),
  ];
} else {
  transports = [
    new winston.transports.File({ filename: './logs/error.log', level: 'error', format: fileFormat }),
    new winston.transports.File({ filename: './logs/trades.log', format: fileFormat }),
    new winston.transports.File({ filename: './logs/app.log', format: fileFormat }),
  ];
}

export const logger = winston.createLogger({
  level: 'info',
  transports
});

const icons = { info: '●', warn: '▲', error: '✖', success: '✔', trade: '◆', snipe: '⚡' };

export function log(level, msg, data = null) {
  const time = new Date().toLocaleTimeString();
  const colors = {
    info:    chalk.cyan,
    warn:    chalk.yellow,
    error:   chalk.red,
    success: chalk.green,
    trade:   chalk.magenta,
    snipe:   chalk.bgYellow.black,
  };
  const color = colors[level] || chalk.white;
  const icon  = icons[level] || '●';
  const line  = `${chalk.gray(time)} ${color(icon + ' ' + msg)}`;
  console.log(line);
  if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));

  // Mirror to dashboard
  broadcast('log', { level, msg, data, time });

  logger.info({ level, msg, data });
}