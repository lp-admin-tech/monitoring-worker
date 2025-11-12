const supabaseModule = require('../supabase-client');
const { supabaseClient } = require('../supabase-client');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');

const supabase = supabaseClient;

async function uploadToStorage(publisherId, data) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const bucket = 'crawler-data';
    const uploadedPaths = {};

    const harPath = `${publisherId}/har/${timestamp}.json`;
    await uploadFile(bucket, harPath, JSON.stringify(data.har, null, 2), 'application/json');
    uploadedPaths.har = harPath;
    logger.debug(`Uploaded HAR to ${harPath}`);

    const mutationLogPath = `${publisherId}/mutations/${timestamp}.json`;
    await uploadFile(bucket, mutationLogPath, JSON.stringify(data.mutationLog, null, 2), 'application/json');
    uploadedPaths.mutationLog = mutationLogPath;
    logger.debug(`Uploaded mutation log to ${mutationLogPath}`);

    const domSnapshotPath = `${publisherId}/dom/${timestamp}.json`;
    await uploadFile(bucket, domSnapshotPath, JSON.stringify(data.domSnapshot, null, 2), 'application/json');
    uploadedPaths.domSnapshot = domSnapshotPath;
    logger.debug(`Uploaded DOM snapshot to ${domSnapshotPath}`);

    const crawlDataPath = `${publisherId}/crawl/${timestamp}.json`;
    await uploadFile(bucket, crawlDataPath, JSON.stringify(data.crawlData, null, 2), 'application/json');
    uploadedPaths.crawlData = crawlDataPath;
    logger.debug(`Uploaded crawl data to ${crawlDataPath}`);

    logger.info('All files uploaded successfully', { publisherId, uploadedPaths });
    return uploadedPaths;
  } catch (error) {
    logger.error('Failed to upload to storage', error);
    throw error;
  }
}

async function uploadFile(bucket, path, content, contentType) {
  try {
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .upload(path, Buffer.from(content), {
        contentType,
        upsert: true,
      });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    logger.error(`Failed to upload file to ${path}`, error);
    throw error;
  }
}

async function uploadScreenshot(bucket, publisherId, screenshotPath) {
  try {
    const fileContent = fs.readFileSync(screenshotPath);
    const timestamp = new Date().getTime();
    const remotePath = `${publisherId}/screenshots/${timestamp}.png`;

    const { data, error } = await supabase
      .storage
      .from(bucket)
      .upload(remotePath, fileContent, {
        contentType: 'image/png',
        upsert: false,
      });

    if (error) {
      throw error;
    }

    fs.unlinkSync(screenshotPath);
    logger.debug(`Screenshot uploaded and cleaned up: ${remotePath}`);

    return remotePath;
  } catch (error) {
    logger.error('Failed to upload screenshot', error);
    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
    return null;
  }
}

async function downloadHAR(publisherId, timestamp) {
  try {
    const bucket = 'crawler-data';
    const harPath = `${publisherId}/har/${timestamp}.json`;

    const { data, error } = await supabase
      .storage
      .from(bucket)
      .download(harPath);

    if (error) {
      throw error;
    }

    const text = await data.text();
    return JSON.parse(text);
  } catch (error) {
    logger.error(`Failed to download HAR for ${publisherId}/${timestamp}`, error);
    throw error;
  }
}

async function listPublisherCrawls(publisherId) {
  try {
    const bucket = 'crawler-data';
    const prefix = `${publisherId}/crawl`;

    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list(prefix);

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    logger.error(`Failed to list crawls for publisher ${publisherId}`, error);
    return [];
  }
}

module.exports = {
  uploadToStorage,
  uploadFile,
  uploadScreenshot,
  downloadHAR,
  listPublisherCrawls,
};
