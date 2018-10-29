import fs from 'fs';
import path from 'path';
import moment from 'moment';
import whitelist from 'validator/lib/whitelist';

import logger from '../logger';

import prettyBytes from 'pretty-bytes';

const getClientIp = (req) => {
  let ipAddress;
  // The request may be forwarded from local web server.
  const forwardedIpsStr = req.header('x-forwarded-for'); 
  if (forwardedIpsStr) {
    // 'x-forwarded-for' header may return multiple IP addresses in
    // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
    // the first one
    const forwardedIps = forwardedIpsStr.split(',');
    ipAddress = forwardedIps[0];
  }
  if (!ipAddress) {
    // If request was not forwarded
    ipAddress = req.connection.remoteAddress;
  }
  const ipAddressSanitized = whitelist(ipAddress, '\\[0-9\.\\]'); //^[0-9\.\-\/]+$)
  return ipAddressSanitized;
};
// nmeaLines = nmeaLines.filter((str) => {
//   return /\S/.test(str);
// });


/**
 * parseData
 * * Parses the nmea data sent via tcp
 * @param {buffer} 'data'
 */
const parseData = (data) => {
  let nmeaSentences = data.toString().split('\r\n');

  nmeaSentences = nmeaSentences.filter(line => (line.length !== 0));

  const nmeaSanitized = nmeaSentences.map((line) => {
    try {
      line = nmeaSanitizer(line);
    } catch (err) {
      logger.error(err);
    }
    return line;
  });
  
  const nmeaFiltered = nmeaSanitized.filter((line) => {
    if (isNmea(line)) {
      return line;
    }
  });

  if (nmeaFiltered.length !== nmeaSanitized.length) {
    // TODO : Register log files when sentences are wrong
    logger.warn(`Issues parsing nmea sentences! (from parseData)`);
  }

  return nmeaFiltered;
}

/**
 * Check NMEA sentences and return false or true
 * @param {string} 'data, the nmea string'
 * @return {boolean} 'Returns a boolean that depends if it's a nmea sentence'
 */
const isNmea = (data) => {
  if (typeof(data) !== 'string') {
    throw Error (`cannot use a ${typeof(data)}, instead pass a string`);
  } else if (data.length === 0) {
    throw Error ('cannot check an empty string');
  }
  return /^\$.*\*[0-9A-Fa-fx]{2}$/.test(data);
}


/**
 * @param {array} 'nmea'
 * @param {array} 'sLength'
 * @param {boolean} 'gsv'
 */
const nmeaParse = (nmea, sLength, gsv) => {
  const sub = sLength - nmea.length;
  if (nmea.length > sLength) {
    if (gsv) {
      // console.log('nmea ', nmea)
      // console.log('sub ', sub)
    }
    nmea.splice(sLength, Math.abs(sub));
  } else {
    const nmeaFill = Array(sub).fill('');
    nmea = [...nmea, ...nmeaFill];
  }
  return nmea;
}

/**
 * @param {string} 'nmea sentence'
 * @return {string} 'checksum'
 */
const generateCheckSum = (str) => {
  if (typeof (str) !== 'string') {
    throw Error(`cannot use a ${typeof (str)}, instead pass a string`);
  } else if (str.length === 0) {
    throw Error('cannot accept an empty string');
  }

  const asteriskEnd = str.lastIndexOf('*');
  // We don't need this sign to generate the checksum
  if (str.includes('$')) {
    str = str.replace('$', '');
  }

  if (asteriskEnd !== -1) {
    str = str.slice(0, asteriskEnd-1);
  }
  
  let checksum = 0; 

  const letters = str.split('');

  letters.forEach((char) => {
    checksum ^= char.charCodeAt(0);;
  });

  return checksum.toString(16).toUpperCase();
}


/**
 * Sanitize NMEA sentences
 * @param {string} 'nmea string'
 * @return {string} 'nmea string sanitized'
 */
const nmeaSanitizer = (line) => {
  let type;
  // GSA default length
  let sLength = 16-1;
  
  if (typeof(line) !== 'string') {
    throw Error (`cannot use a ${typeof(line)}, instead pass a string`);
  } else if (line.length === 0) {
    throw Error ('cannot accept an empty string');
  }

  type = line.substr(3, 3);
  let nmea = line.split(/[*,]/);

  // Delete checksum on last position
  nmea.pop();

  switch (type) {
    case 'GSV':
      sLength = 9-1;
      if (nmea.length < sLength) {
        while (nmea.length % 4 !== 1) {
          nmea.push('');
        }
      } else {
        while (nmea.length % 4 !== 1) {
          nmea.pop();
        }
      }
      // The gps library counts the checksum in length
      nmea.pop();
      line = nmea.join(',');
      const checksum = generateCheckSum(line);
      line = `${line}*${checksum}`;
      break;
    case 'GSA':
      sLength = 19-1;
    case 'GGA':
      if (nmea.length !== sLength) {
        nmea = nmeaParse(nmea, sLength);
        line = nmea.join(',') + '*' + generateCheckSum(line);
      }
      break;
    case 'RMC':
      sLength = 14-1;
      if (nmea.length !== 13-1 && nmea.length !== sLength) {
        nmea = nmeaParse(nmea, sLength);
        line = nmea.join(',') + generateCheckSum(line);
      }
      break;
    default:
      console.log(`Unknown ${type}`);
      break;
    }
  return line;
}

/**
 * Is used to get the previous loaded configs stored in a json
 * @return {object}
 */
const getRtkConfigsFromJson = () => {
  const jsonPath = path.join(__dirname, '..', 'RTKLIB', 'config.json');
  let jsonData = {};

  try {
    jsonData = fs.readFileSync(jsonPath);
    jsonData = JSON.parse(jsonData);
    logger.info(`loaded configs from config.json`);
  } catch (err) {
    logger.error(`unable to read config.json using defaults`);
    jsonData.error = true;
  }

  return jsonData;
}
/**
 * @param {string} 'configsPath'
 * @param {string} 'configName'
 * @return {object} 'newData'
 */
const readConfigFile = (configsPath, configName) => {
  let newData = {};
  let stats, data;

  if (configsPath && configName && typeof(configsPath) === 'string' &&
    typeof(configName) === 'string') {

    try {
      data = fs.readFileSync(configsPath + '/' + configName) 
    } catch (error) {
      logger.error(`trying to read a configFile, ${configsPath}/${configName}`);
    }

    try {
      stats = fs.statSync(configsPath + '/' + configName);
    } catch (error) {
      logger.error(`checking stats, ${configsPath}/${configName}`);
    }
    
    if (data && stats) {
      newData = {
        name: configName,
        str: data.toString(),
        mtime: moment(stats.mtime).format('lll'),
        size: prettyBytes(stats.size),
      };
      logger.info(`Succesfully read configFile, ${configsPath}/${configName}`);
    }
      
  }
  return newData;
}

/**
 * This function checks if config.json exits and creates it when it doesn't exist
 * @param {string} configsPath
 */
const settingsToJson = (configsPath) => {
  const jsonPath = path.join(__dirname, '..', 'RTKLIB', 'config.json');

  let jsonData = {
      name: "default.conf",
      str: "",
      mtime: "",
      size: "",
    };
  
  // Read config JSON
  fs.readFile(jsonPath, 'utf8', async (err, data) => {
    if (err) {
      // unable to access to the file... create it
      try {
        fs.writeFileSync(jsonPath, JSON.stringify(jsonData));
      } catch (error) {
        logger.error(`writing rtk json config ${jsonPath}`);
      }
    } else {
      // Use the data received
      jsonData = JSON.parse(data);
    }

    if (!fs.existsSync(`${configsPath}/${jsonData.name}`)) {
      logger.error(`reading rtklib config ${configsPath}/${jsonData.name}`);
    } else {
      // read configFile and returns an object
      jsonData = await readConfigFile(configsPath, jsonData.name);
        // Save new json config from configs folder to json folder
        if (data !== jsonData.str) {
          fs.writeFile(jsonPath, JSON.stringify(jsonData), (error) => {
            if (error) {
              logger.error('saving new config');
            }
          });
        }
    }
  });
}

/**
 * Returns an object 
 * @param {string} data
 * @return {object}
 */
const parseRtkConfigs = (data) => {
  if (typeof (data) !== 'string') {
    throw Error('Send a string');
  } else if (data.length === 0) {
    throw Error('Don\'t send an empty string');
  }

  const filterHashLines = line => {
    if (line.indexOf('#') !== 0) {
      return line;
    }
  }

  const cleanLines = line => {
    const lineClean = line.replace(/\s/g, '');
    if (line.indexOf('#') !== 0) {
      lineClean.substr(0, lineClean.indexOf('#'));
    }
    return lineClean;
  }

  const dataSplitted = data.split('\n');
  const oData = {};
  const dataFiltered = dataSplitted.filter(filterHashLines).map(cleanLines);

  dataFiltered.forEach(line => {
    line = line.split('=');
    oData[line[0]] = line[1];
  });

  return oData;
}

const isRtkConfig = (data) => {
  if (typeof (data) !== 'string') {
    throw Error(`cannot use a ${typeof (data)}, instead pass a string`);
  } else if (data.length === 0) {
    throw Error('cannot check an empty string');
  }
  return /[a-z-A-Z-0-9-(). #=,:]/.test(data);
}

export {
  getClientIp,
  parseData,
  settingsToJson,
  getRtkConfigsFromJson,
  readConfigFile,
  parseRtkConfigs,
  isRtkConfig,
};
