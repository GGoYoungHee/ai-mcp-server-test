import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InferenceClient } from '@huggingface/inference'
import { z } from 'zod'

// Optional: Configuration schema for user settings
export const configSchema = z.object({
    hfToken: z.string().optional().describe('Hugging Face API token for image generation (optional)')
})

// Required: Export default createServer function
export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {
    // Create server instance
    const server = new McpServer({
        name: 'my-mcp-server',
        version: '1.0.0',
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    })

    // Server info resource - returns fake server status
    server.resource(
        'server-info',
        'server://info',
        async (uri) => {
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify({
                        status: 'operational',
                        serverName: 'Test Server',
                        activeConnections: 42,
                        cpuLoad: 15,
                        memoryUsage: '256MB',
                        version: '1.0.0'
                    }, null, 2)
                }]
            }
        }
    )

    // Code review prompt
    server.prompt(
        'code_review',
        {
            code: z.string().describe('The code to review')
        },
        ({ code }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please review the following code:\n\n\`\`\`\n${code}\n\`\`\`\n\nFocus on:\n1. Potential bugs\n2. Code style and best practices\n3. Performance improvements\n4. Security vulnerabilities`
                }
            }]
        })
    )

    // Greeting tool - returns a greeting message in the specified language
    server.registerTool(
        'greeting',
        {
            title: 'Greeting',
            description: 'Returns a greeting message in the specified language',
            inputSchema: {
                name: z.string().describe('The name of the person to greet'),
                language: z.enum(['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de']).describe('The language for the greeting (en, ko, ja, zh, es, fr, de)')
            },
            outputSchema: {
                greeting: z.string()
            }
        },
        async ({ name, language }) => {
            const greetings: Record<string, string> = {
                en: `Hello, ${name}!`,
                ko: `안녕하세요, ${name}님!`,
                ja: `こんにちは、${name}さん！`,
                zh: `你好，${name}！`,
                es: `¡Hola, ${name}!`,
                fr: `Bonjour, ${name}!`,
                de: `Hallo, ${name}!`
            }

            const output = { greeting: greetings[language] }
            return {
                content: [{ type: 'text', text: output.greeting }],
                structuredContent: output
            }
        }
    )

    // Calc tool - performs basic arithmetic operations
    server.registerTool(
        'calc',
        {
            title: 'Calculator',
            description: 'Performs basic arithmetic operations on two numbers',
            inputSchema: {
                a: z.number().describe('The first number'),
                b: z.number().describe('The second number'),
                operator: z.enum(['+', '-', '*', '/']).describe('The arithmetic operator (+, -, *, /)')
            },
            outputSchema: {
                result: z.number()
            }
        },
        async ({ a, b, operator }) => {
            let result: number

            switch (operator) {
                case '+':
                    result = a + b
                    break
                case '-':
                    result = a - b
                    break
                case '*':
                    result = a * b
                    break
                case '/':
                    if (b === 0) {
                        return {
                            content: [{ type: 'text', text: 'Error: Division by zero' }],
                            isError: true
                        }
                    }
                    result = a / b
                    break
            }

            const output = { result }
            return {
                content: [{ type: 'text', text: `${a} ${operator} ${b} = ${result}` }],
                structuredContent: output
            }
        }
    )

    // Current time tool - returns current time in the specified timezone
    server.registerTool(
        'current_time',
        {
            title: 'Current Time',
            description: 'Returns the current time in the specified timezone',
            inputSchema: {
                timezone: z.string().describe("IANA timezone name (e.g., 'Asia/Seoul', 'America/New_York', 'Europe/London', 'Asia/Tokyo')")
            },
            outputSchema: {
                timezone: z.string(),
                datetime: z.string(),
                date: z.string(),
                time: z.string()
            }
        },
        async ({ timezone }) => {
            try {
                const now = new Date()
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                })

                const parts = formatter.formatToParts(now)
                const getPart = (type: string) => parts.find(p => p.type === type)?.value || ''

                const date = `${getPart('year')}-${getPart('month')}-${getPart('day')}`
                const time = `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`
                const datetime = `${date} ${time}`

                const output = { timezone, datetime, date, time }
                return {
                    content: [{ type: 'text', text: `Current time in ${timezone}: ${datetime}` }],
                    structuredContent: output
                }
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Error: Invalid timezone '${timezone}'. Please use IANA timezone format (e.g., 'Asia/Seoul', 'America/New_York')` }],
                    isError: true
                }
            }
        }
    )

    // Image generation tool - generates an image from a text prompt
    server.registerTool(
        'generate_image',
        {
            title: 'Image Generator',
            description: 'Generates an image from a text prompt using FLUX.1-schnell model',
            inputSchema: {
                prompt: z.string().describe('The text prompt to generate an image from')
            }
        },
        async ({ prompt }) => {
            try {
                // Use config.hfToken if provided, otherwise fall back to environment variable
                const token = config?.hfToken || process.env.HF_TOKEN
                if (!token) {
                    return {
                        content: [{ type: 'text', text: 'Error: Hugging Face token not configured. Please provide hfToken in config or set HF_TOKEN environment variable.' }],
                        isError: true
                    }
                }

                const client = new InferenceClient(token)

                const image = await client.textToImage(
                    {
                        provider: 'auto',
                        model: 'black-forest-labs/FLUX.1-schnell',
                        inputs: prompt,
                        parameters: { num_inference_steps: 5 }
                    },
                    { outputType: 'blob' }
                )

                // Convert Blob to base64
                const arrayBuffer = await image.arrayBuffer()
                const base64Data = Buffer.from(arrayBuffer).toString('base64')

                return {
                    content: [{
                        type: 'image',
                        data: base64Data,
                        mimeType: 'image/png',
                        annotations: {
                            audience: ['user'],
                            priority: 0.9
                        }
                    }]
                }
            } catch (error) {
                return {
                    content: [{ type: 'text', text: `Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}` }],
                    isError: true
                }
            }
        }
    )

    // Return the MCP server object
    return server.server
}
