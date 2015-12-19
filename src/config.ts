import * as moment from 'moment';
import Moment = moment.Moment;

export interface Config {
  production: boolean
  development: boolean
  gitDate: Moment;
  gitHash: string;
}

const env = process.env.NODE_ENV;
const gitDate = moment(process.env.GIT_DATE, 'YYYY-MM-DD HH:mm:ss ZZ');
const gitHash = process.env.GIT_HASH;

export const config: Config = {
  production: env === 'production',
  development: env === 'development',
  gitDate,
  gitHash
};
