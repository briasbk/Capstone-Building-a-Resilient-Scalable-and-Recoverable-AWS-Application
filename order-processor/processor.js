const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");

const client = new SQSClient({ region: "us-east-1" });
const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/508471420037/ecommerce-orders-queue";

async function processOrder(message) {
  console.log("Processing order:", message.Body);
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log("Order processed successfully!");
}

async function pollQueue() {
  console.log("Order processor started. Polling queue...");
  while (true) {
    try {
      const response = await client.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
      }));

      if (response.Messages && response.Messages.length > 0) {
        console.log("Received " + response.Messages.length + " order(s)");
        for (const message of response.Messages) {
          await processOrder(message);
          await client.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }));
          console.log("Order deleted from queue");
        }
      } else {
        console.log("No orders in queue. Waiting...");
      }
    } catch (error) {
      console.error("Error processing order:", error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

pollQueue();
