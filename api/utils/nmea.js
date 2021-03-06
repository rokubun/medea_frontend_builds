import logger from '../logger';

/**
 * Check NMEA sentences and return false or true
 * @param {string} 'data, the nmea string'
 * @return {boolean} 'Returns a boolean that depends if it's a nmea sentence'
 */
const isNmea = (data) => {
  if (typeof (data) !== 'string') {
    throw Error(`cannot use a ${typeof (data)}, instead pass a string`);
  } else if (data.length === 0) {
    throw Error('cannot check an empty string');
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
    str = str.slice(0, asteriskEnd - 1);
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
  let sLength = 16 - 1;

  if (typeof (line) !== 'string') {
    throw Error(`cannot use a ${typeof (line)}, instead pass a string`);
  } else if (line.length === 0) {
    throw Error('cannot accept an empty string');
  }

  type = line.substr(3, 3);
  let nmea = line.split(/[*,]/);

  // Delete checksum on last position
  nmea.pop();

  switch (type) {
    case 'GSV':
      sLength = 9 - 1;
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
      sLength = 19 - 1;
    case 'GGA':
      if (nmea.length !== sLength) {
        nmea = nmeaParse(nmea, sLength);
        line = nmea.join(',') + '*' + generateCheckSum(line);
      }
      break;
    case 'RMC':
      sLength = 14 - 1;
      if (nmea.length !== 13 - 1 && nmea.length !== sLength) {
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
 * parseData
 * * Parses the nmea data sent via tcp
 * @param {buffer} 'data'
 */
export const parseData = (data) => {
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