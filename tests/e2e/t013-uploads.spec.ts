/**
 * T-013: File & Image Uploads — E2E Tests
 *
 * Acceptance Criteria:
 * - Files can be attached via button
 * - Images display inline in chat
 * - Lightbox opens on image click
 * - Non-image files show as download rows
 * - File preview chips appear before sending
 * - Upload validation (size limit) works
 */

import { test, expect, type Browser } from '@playwright/test';
import { signupViaAPI } from './helpers';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Creates a separate browser context (isolated cookies) and signs up a user.
 */
async function createIsolatedUser(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { username, userId } = await signupViaAPI(page);
  return { context, page, username, userId };
}

/**
 * Helper: create a room from user's page. After creation the room is
 * auto-opened and the creator is auto-joined.
 */
async function createRoom(page: import('@playwright/test').Page, name: string) {
  await page.getByText('+ NEW ROOM').click();
  await page.locator('#room-name').fill(name);
  await page.getByText('[ CREATE ]').first().click();
  // Wait for the message input to confirm we're in the room and joined
  await expect(page.locator('textarea')).toBeVisible();
}

/**
 * Helper: create a minimal valid PNG file on disk.
 */
function createTempPng(filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
  const filePath = path.join(dir, filename);

  // Minimal valid 1x1 red pixel PNG
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width 1
    0x00, 0x00, 0x00, 0x01, // height 1
    0x08, 0x02,             // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00,       // compression, filter, interlace
    0x90, 0x77, 0x53, 0xde, // CRC
    0x00, 0x00, 0x00, 0x0c, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
    0x00, 0x02, 0x00, 0x01, // IDAT data
    0xe2, 0x21, 0xbc, 0x33, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);

  fs.writeFileSync(filePath, pngBuffer);
  return filePath;
}

/**
 * Helper: create a minimal text file on disk.
 */
function createTempTextFile(filename: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test.describe('T-013: File Uploads — Attach and Send', () => {
  test('should attach a file via button and see preview chip', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `Upload-${Date.now()}`;

    // Create room (auto-joined, auto-opened)
    await createRoom(user.page, roomName);

    // Create a temp PNG
    const pngPath = createTempPng('test-image.png');

    // Set file on the hidden file input
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Verify preview chip appears with filename
    await expect(user.page.getByText('test-image.png')).toBeVisible();

    // Clean up
    fs.unlinkSync(pngPath);
    await user.context.close();
  });

  test('should send a message with an image attachment and see it inline', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `ImgSend-${Date.now()}`;

    await createRoom(user.page, roomName);

    const pngPath = createTempPng('screenshot.png');

    // Attach file
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Type a message
    await user.page.locator('textarea').fill('Check this image!');

    // Send
    await user.page.locator('button:text-is("SEND")').click();

    // Verify the message text appears
    await expect(user.page.getByText('Check this image!')).toBeVisible();

    // Verify an image is rendered inline (from the attachment)
    await expect(user.page.locator('img[alt="screenshot.png"]')).toBeVisible({ timeout: 10000 });

    fs.unlinkSync(pngPath);
    await user.context.close();
  });

  test('should send a file-only message (no text)', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `FileOnly-${Date.now()}`;

    await createRoom(user.page, roomName);

    const pngPath = createTempPng('photo.png');

    // Attach file without typing text
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Send — button should be enabled because files are attached
    await user.page.locator('button:text-is("SEND")').click();

    // Verify the image appears inline
    await expect(user.page.locator('img[alt="photo.png"]')).toBeVisible({ timeout: 10000 });

    fs.unlinkSync(pngPath);
    await user.context.close();
  });

  test('should remove a file from preview before sending', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `Remove-${Date.now()}`;

    await createRoom(user.page, roomName);

    const pngPath = createTempPng('removeme.png');
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);

    // Preview chip should be visible
    await expect(user.page.getByText('removeme.png')).toBeVisible();

    // Click the remove button (x) on the chip
    await user.page.getByRole('button', { name: /remove removeme\.png/i }).click();

    // Preview chip should be gone
    await expect(user.page.getByText('removeme.png')).not.toBeVisible();

    fs.unlinkSync(pngPath);
    await user.context.close();
  });
});

test.describe('T-013: File Uploads — Non-Image Files', () => {
  test('should display non-image files as download rows', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `TextFile-${Date.now()}`;

    await createRoom(user.page, roomName);

    const txtPath = createTempTextFile('notes.txt', 'Hello from test file');
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(txtPath);

    await user.page.locator('textarea').fill('Here are my notes');
    await user.page.locator('button:text-is("SEND")').click();

    // Verify message text and download row with filename
    await expect(user.page.getByText('Here are my notes')).toBeVisible();
    await expect(user.page.locator('a[download="notes.txt"]')).toBeVisible({ timeout: 10000 });

    fs.unlinkSync(txtPath);
    await user.context.close();
  });
});

test.describe('T-013: File Uploads — Lightbox', () => {
  test('should open lightbox on image click and close on Escape', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `Lightbox-${Date.now()}`;

    await createRoom(user.page, roomName);

    const pngPath = createTempPng('lightbox-test.png');
    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(pngPath);
    await user.page.locator('button:text-is("SEND")').click();

    // Wait for the inline image to appear
    const inlineImage = user.page.locator('img[alt="lightbox-test.png"]');
    await expect(inlineImage).toBeVisible({ timeout: 10000 });

    // Click the inline image to open lightbox
    await inlineImage.click();

    // Lightbox overlay should be visible
    await expect(user.page.locator('[data-testid="lightbox-overlay"]')).toBeVisible();

    // Press Escape to close
    await user.page.keyboard.press('Escape');
    await expect(user.page.locator('[data-testid="lightbox-overlay"]')).not.toBeVisible();

    fs.unlinkSync(pngPath);
    await user.context.close();
  });
});

test.describe('T-013: File Uploads — Validation', () => {
  test('should show error for oversized files', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `BigFile-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Create a file > 10 MB
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
    const bigFilePath = path.join(dir, 'big.png');
    // Write PNG header + 11 MB of padding
    const header = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const padding = Buffer.alloc(11 * 1024 * 1024);
    fs.writeFileSync(bigFilePath, Buffer.concat([header, padding]));

    const fileInput = user.page.locator('input[type="file"]');
    await fileInput.setInputFiles(bigFilePath);

    // Should show error message about size limit
    await expect(user.page.getByText(/exceeds 10 MB/i)).toBeVisible();

    fs.unlinkSync(bigFilePath);
    await user.context.close();
  });
});
