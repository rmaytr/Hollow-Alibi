import {chromium} from 'playwright';
export {chromium};
export const browserOptions = {
  headless:true,
  ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {}),
  args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'],
};
