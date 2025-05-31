const winston = require('winston');
const { combine, timestamp, json } = winston.format;

//dotenv access
require('dotenv')
    .config('/.env');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(timestamp(), json()),
    transports: [new winston.transports.Console()],
})

module.exports = logger;