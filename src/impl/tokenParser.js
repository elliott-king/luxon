import { Util } from './util';
import { Formatter } from './formatter';
import { FixedOffsetZone } from '../zones/fixedOffsetZone';
import { IANAZone } from '../zones/IANAZone';

function intUnit(regex, post = i => i) {
  return { regex, deser: ([s]) => post(parseInt(s, 10)) };
}

function oneOf(strings, startIndex) {
  return { regex: RegExp(strings.join('|')), deser: ([s]) => strings.indexOf(s) + startIndex };
}

function offset(regex, groups) {
  return { regex, deser: ([, h, m]) => Util.signedOffset(h, m), groups };
}

function simple(regex) {
  return { regex, deser: ([s]) => s };
}

function unitForToken(token, loc) {
  const one = /\d/,
    two = /\d\d/,
    three = /\d{3}/,
    four = /\d{4}/,
    oneOrTwo = /\d\d?/,
    oneToThree = /\d\d{2}?/,
    twoToFour = /\d\d\d{2}?/,
    literal = t => ({ regex: RegExp(t.val), deser: ([s]) => s, literal: true }),
    unitate = t => {
      if (token.literal) {
        return literal(t);
      }

      switch (t.val) {
        // era
        case 'G':
          return oneOf(loc.eras('short'), 0);
        case 'GG':
          return oneOf(loc.eras('long'), 0);
        // years
        case 'yyyy':
          return intUnit(four);
        case 'yy':
          return intUnit(twoToFour, Util.untruncateYear);
        // months
        case 'M':
          return intUnit(oneOrTwo);
        case 'MM':
          return intUnit(two);
        case 'MMM':
          return oneOf(loc.months('short', true), 1);
        case 'MMMM':
          return oneOf(loc.months('long', true), 1);
        case 'L':
          return intUnit(oneOrTwo);
        case 'LL':
          return intUnit(two);
        case 'LLL':
          return oneOf(loc.months('short', false), 1);
        case 'LLLL':
          return oneOf(loc.months('long', false), 1);
        // dates
        case 'd':
          return intUnit(oneOrTwo);
        case 'dd':
          return intUnit(two);
        // ordinals
        case 'o':
          return intUnit(oneToThree);
        case 'ooo':
          return intUnit(three);
        // time
        case 'HH':
          return intUnit(two);
        case 'H':
          return intUnit(oneOrTwo);
        case 'hh':
          return intUnit(two);
        case 'h':
          return intUnit(oneOrTwo);
        case 'mm':
          return intUnit(two);
        case 'm':
          return intUnit(oneOrTwo);
        case 's':
          return intUnit(oneOrTwo);
        case 'ss':
          return intUnit(two);
        case 'S':
          return intUnit(oneToThree);
        case 'SSS':
          return intUnit(three);
        // meridiem
        case 'a':
          return oneOf(loc.meridiems(), 0);
        // weekYear (k)
        case 'kkkk':
          return intUnit(four);
        case 'kk':
          return intUnit(twoToFour, Util.untruncateYear);
        // weekNumber (W)
        case 'W':
          return intUnit(oneOrTwo);
        case 'WW':
          return intUnit(two);
        // weekdays
        case 'E':
          return intUnit(one);
        case 'EEE':
          return oneOf(loc.weekdays('short'), 1);
        case 'EEEE':
          return oneOf(loc.weekdays('long'), 1);
        // offset/zone
        case 'Z':
        case 'ZZ':
          return offset(/([+-]\d{1,2})(?::(\d{2}))?/, 2);
        case 'ZZZ':
          return offset(/([+-]\d{1,2})(\d{2})?/, 2);
        // we don't support ZZZZ (PST) or ZZZZZ (Pacific Standard Time) in parsing
        // because we don't have any way to figure out what they are
        case 'z':
          return simple(/[A-Za-z_]+\/[A-Za-z_]+/);
        default:
          return literal(t);
      }
    },
    unit = unitate(token);
  unit.token = token;
  return unit;
}

function buildRegex(units) {
  return [units.map(u => u.regex).reduce((f, r) => `${f}(${r.source})`, ''), units];
}

function match(input, regex, handlers) {
  const matches = input.match(regex);

  if (matches) {
    const all = {};
    let matchIndex = 1;
    for (const i in handlers) {
      if (handlers.hasOwnProperty(i)) {
        const h = handlers[i],
          groups = h.groups ? h.groups + 1 : 1;
        if (!h.literal && h.token) {
          all[h.token.val[0]] = h.deser(matches.slice(matchIndex, matchIndex + groups));
        }
        matchIndex += groups;
      }
    }
    return all;
  } else {
    return {};
  }
}

function dateTimeFromMatches(matches) {
  const toField = token => {
    switch (token) {
      case 'S':
        return 'millisecond';
      case 's':
        return 'second';
      case 'm':
        return 'minute';
      case 'h':
      case 'H':
        return 'hour';
      case 'd':
        return 'day';
      case 'o':
        return 'ordinal';
      case 'L':
      case 'M':
        return 'month';
      case 'y':
        return 'year';
      case 'E':
      case 'c':
        return 'weekday';
      case 'W':
        return 'weekNumber';
      case 'k':
        return 'weekYear';
      default:
        return null;
    }
  };

  let zone;
  if (!Util.isUndefined(matches.Z)) {
    zone = new FixedOffsetZone(matches.Z);
  } else if (!Util.isUndefined(matches.z)) {
    zone = new IANAZone(matches.z);
  } else {
    zone = null;
  }

  if (!Util.isUndefined(matches.h) && matches.a === 1) {
    matches.h += 12;
  }

  if (matches.G === 0 && matches.y) {
    matches.y = -matches.y;
  }

  const vals = Object.keys(matches).reduce((r, k) => {
    const f = toField(k);
    if (f) {
      r[f] = matches[k];
    }

    return r;
  }, {});

  return [vals, zone];
}

/**
 * @private
 */

export class TokenParser {
  constructor(loc) {
    Object.defineProperty(this, 'loc', { value: loc, enumerable: true });
  }

  explainParse(input, format) {
    const tokens = Formatter.parseFormat(format),
      units = tokens.map(t => unitForToken(t, this.loc)),
      [regex, handlers] = buildRegex(units),
      matches = match(input, regex, handlers),
      [result, zone] = matches ? dateTimeFromMatches(matches) : [null, null];

    return { input, tokens, regex, matches, result, zone };
  }

  parseDateTime(input, format) {
    const { result, zone } = this.explainParse(input, format);
    return [result, zone];
  }
}