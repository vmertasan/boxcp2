const BoxSDK = require('box-node-sdk');
const fs = require('fs/promises');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');

// Set up Box SDK configuration
const sdkConfig = JSON.parse(process.env.BOX_CONFIG);
const sdk = BoxSDK.getPreconfiguredInstance(sdkConfig);
const client = sdk.getAppAuthClient('enterprise', '1245868755');
const adminClient = sdk.getAppAuthClient('user', '39705731625');

async function removeWatermark(fileId) {
  try {
    await adminClient.post(`/files/${fileId}/watermark`);
    console.log(`Watermark removed from file ${fileId}`);
  } catch (error) {
    console.error(`Failed to remove watermark: ${error.message}`);
    throw error;
  }
}

async function applyWatermark(fileId) {
  try {
    await adminClient.files.removeWatermark(fileId);
    await client.files.applyWatermark(fileId);
    console.log(`Watermark reapplied to file ${fileId}`);
  } catch (error) {
    console.error(`Failed to apply watermark: ${error.message}`);
    throw error;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  const method = event.httpMethod;
  const requestPath = event.path;

  if (method === 'GET' && requestPath.includes('/download/')) {
    const fileId = requestPath.split('/').pop();
    console.log(`Handling file download request for fileId: ${fileId}`);

    if (!fileId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'File ID is required' }) };
    }

    const tempFilePath = `/tmp/${fileId}.pdf`;
    const watermarkedFilePath = `/tmp/${fileId}.watermarked.pdf`;

    try {
      let fileBuffer;

      try {
        const stream = await client.files.getReadStream(fileId);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
      } catch (error) {
        if (error.statusCode === 403) {
          console.log("403 Forbidden error encountered. Attempting recovery process.");
          return { statusCode: 403, headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          }, body: JSON.stringify({ message: error.message}) };
          const stream = await client.files.getReadStream(fileId);
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          fileBuffer = Buffer.concat(chunks);
        } else throw error;
      }

      await fs.writeFile(tempFilePath, fileBuffer);

      const pdfDoc = await PDFDocument.load(fileBuffer);
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const watermarkText = 'akadirov@boxdemo - 11:01PM EST';
      const textSize = 50;
      const opacity = 0.3;
      const pages = pdfDoc.getPages();

      pages.forEach((page) => {
        const { width, height } = page.getSize();
        const xInterval = width / 3;
        const yInterval = height / 3;

        for (let x = 0; x < width; x += xInterval) {
          for (let y = 0; y < height; y += yInterval) {
            page.drawText(watermarkText, {
              x: x,
              y: y,
              size: textSize,
              font: helveticaFont,
              color: rgb(0, 0, 0),
              opacity: opacity,
              rotate: degrees(45),
            });
          }
        }
      });

      const watermarkedPdfBytes = await pdfDoc.save();
      await fs.writeFile(watermarkedFilePath, watermarkedPdfBytes);

      const watermarkedBuffer = await fs.readFile(watermarkedFilePath);
      await fs.unlink(tempFilePath);
      await fs.unlink(watermarkedFilePath);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="watermarked-file.pdf"`,
          "Access-Control-Allow-Origin": "*",
        },
        body: watermarkedBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      console.error(`Error processing file: ${error.message}`);
      return { statusCode: 500, body: JSON.stringify({ message: 'Failed to process file', error: error.message }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request method or endpoint' }) };
};
