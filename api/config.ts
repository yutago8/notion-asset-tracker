import { NowRequest, NowResponse } from '@vercel/node';
import { config } from '../src/config';

export default function handler(_req: NowRequest, res: NowResponse) {
  res.status(200).json({ baseCurrency: config.baseCurrency });
}

