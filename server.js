// Load the libraries we need
const express = require('express');
const fetch = require('node-fetch');
const paypal = require('@paypal/checkout-server-sdk');
const nodemailer = require('nodemailer');
require('dotenv').config(); // This loads your secret keys from the .env file

const app = express();
app.use(express.json()); // Middleware to understand JSON
app.use(express.static('.')); // Serve your HTML files

// --- PayPal Configuration ---
const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GEMINI_API_KEY } = process.env;
const environment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
const client = new paypal.core.PayPalHttpClient(environment);

// --- Nodemailer (Email) Configuration ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, 
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// --- AI Message Generation Function ---
async function generateThankYouMessage(name, amount, message) {
    try {
        let prompt = `Write a short, warm, and personal thank you message for a person named ${name} who just donated $${amount}. This donation is for our "HopeSpring Foundation" fundraiser, which provides school supplies for underprivileged children. Mention the impact on the children.`;
        if (message) {
            prompt += ` The donor also left this kind message: "${message}". Please subtly weave a reference to their message into your thank you.`;
        }
        prompt += ` Keep the tone grateful and heartfelt. Two sentences maximum.`;

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
        const apiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!apiResponse.ok) {
            console.error(`Gemini API request failed with status ${apiResponse.status}`);
            throw new Error('API request failed');
        }

        const data = await apiResponse.json();
        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text.trim();
        } else {
            throw new Error("Invalid response structure from Gemini API.");
        }
    } catch (error) {
        console.error('Error generating AI message:', error);
        return `Thank you so much for your generous donation of $${amount}, ${name}! Your support means the world to us and will make a real difference.`;
    }
}

// --- PayPal API Endpoints ---
app.post('/api/paypal/create-order', async (req, res) => {
    // ... (rest of the function is the same)
    const { amount, donorInfo } = req.body;
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: {
                currency_code: 'USD',
                value: amount.toFixed(2)
            },
            custom_id: JSON.stringify(donorInfo)
        }]
    });
    try {
        const order = await client.execute(request);
        res.json({ orderID: order.result.id });
    } catch (err) {
        console.error('Failed to create order:', err);
        res.status(500).json({ error: 'Failed to create order.' });
    }
});

app.post('/api/paypal/capture-order', async (req, res) => {
    // ... (rest of the function is the same)
    const { orderID } = req.body;
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    try {
        const capture = await client.execute(request);
        res.json({ status: 'success', capture });
    } catch (err) {
        console.error('Failed to capture order:', err);
        res.status(500).json({ error: 'Failed to capture order.' });
    }
});

// --- Webhook Verification Endpoint ---
app.get('/api/webhooks/paypal', (req, res) => {
    // ... (rest of the function is the same)
    console.log('✅ Received a GET request to the webhook URL for validation.');
    res.status(200).send('Webhook endpoint is active and listening for POST requests.');
});

// --- PayPal Webhook Endpoint ---
app.post('/api/webhooks/paypal', async (req, res) => {
    // ... (rest of the function is the same)
    const event = req.body;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        console.log('✅ Received successful payment webhook.');
        try {
            const capture = event.resource;
            const amount = capture.amount.value;
            const purchase_unit = capture.purchase_units[0];
            const donorInfo = JSON.parse(purchase_unit.custom_id);
            const { name, email, message } = donorInfo;
            const cause = "HopeSpring Foundation's Children's Fund";
            console.log(`Processing donation: ${amount} from ${name} (${email})`);
            const aiMessage = await generateThankYouMessage(name, amount, message);
            console.log('🤖 AI message generated.');
            await transporter.sendMail({
                from: `"HopeSpring Foundation" <${process.env.EMAIL_FROM}>`,
                to: email,
                subject: `Your incredible support for the HopeSpring Foundation!`,
                html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Thank You for Your Donation!</title>
                    <style>
                        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
                        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
                        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
                        table { border-collapse: collapse !important; }
                        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; font-family: 'Inter', Arial, sans-serif; }
                        .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #1a1a1a; border-radius: 16px; overflow: hidden; border: 1px solid #333333; }
                        .header { background-color: #4f46e5; color: #ffffff; padding: 48px 32px; text-align: center; }
                        .header h1 { margin: 0; font-size: 32px; font-weight: 700; }
                        .content { padding: 40px 32px; color: #d1d5db; line-height: 1.7; font-size: 16px; }
                        .content p { margin: 0 0 20px; }
                        .donation-details { background-color: #2a2a2a; border-radius: 12px; padding: 24px; margin: 28px 0; border-left: 4px solid #4f46e5; }
                        .donation-details p { margin: 0 0 12px; font-size: 16px; }
                        .donation-details p:last-child { margin-bottom: 0; }
                        .donation-details strong { color: #ffffff; }
                        .gemini-message { background-color: #252244; border-radius: 12px; padding: 28px; margin: 28px 0; font-style: italic; color: #c7d2fe; text-align: center; font-size: 18px; line-height: 1.6; }
                        .gemini-message p { margin: 0; }
                        .footer { background-color: #111111; color: #9ca3af; padding: 32px; text-align: center; font-size: 14px; }
                        .footer a { color: #818cf8; text-decoration: none; font-weight: 500; }
                    </style>
                </head>
                <body style="background-color: #000000; padding: 40px 24px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                            <td align="center">
                                <table border="0" cellpadding="0" cellspacing="0" class="container">
                                    <tr><td class="header"><h1>Thank You!</h1></td></tr>
                                    <tr>
                                        <td class="content">
                                            <p>Dear ${name},</p>
                                            <p>We are incredibly grateful for your recent contribution to <strong>HopeSpring Foundation</strong>. Your support makes a real difference and helps us continue our mission.</p>
                                            <div class="donation-details">
                                                <p><strong>Amount:</strong> $${amount}</p>
                                                <p><strong>Cause:</strong> ${cause}</p>
                                                <p><strong>Transaction ID:</strong> ${capture.id}</p>
                                            </div>
                                            <div class="gemini-message"><p>"${aiMessage}"</p></div>
                                            <p>Your kindness is what fuels our work. Thank you once again for your generous support.</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td class="footer">
                                            <p>&copy; 2025 HopeSpring Foundation. All Rights Reserved.</p>
                                            <p><a href="http://localhost:3000" target="_blank">Visit Our Fundraiser</a></p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </body>
                </html>
                `
            });
            console.log(`✉️ Sent new dark-mode email to ${email}.`);
        } catch (error) {
            console.error('Error processing webhook:', error);
            return res.sendStatus(500); 
        }
    }
    res.sendStatus(200);
});

// --- CORRECTED: Start the server ---
// Render provides a PORT environment variable. We should use that.
// If it doesn't exist (like on our local machine), we fall back to 3000.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
