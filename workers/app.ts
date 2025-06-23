import { DurableObject } from "cloudflare:workers"
import { Supermemory } from "supermemory"
import { Hono } from "hono"
import { cors } from "hono/cors"
import {
    type PromptResponseType,
    type Resource,
    type ToolResponseType,
    bridge,
    describePrompt,
    describeTool,
    mValidator,
    muppet,
} from "muppet"
import { SSEHonoTransport, streamSSE } from "muppet/streaming"
import { createRequestHandler } from "react-router"
import { z } from "zod"

declare module "react-router" {
    export interface AppLoadContext {
        cloudflare: {
            env: Env
            ctx: ExecutionContext
        }
    }
}

const requestHandler = createRequestHandler(
    // @ts-ignore
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
)

type AppType = {
    Bindings: Env
}
const app = new Hono<AppType>()

function createSuperMemory(userId: string, env: Env) {

    const supermemory = new Supermemory({
        apiKey: env.SUPERMEMORY_API_KEY,
    })

    const db = env.DB.prepare("SELECT * FROM users WHERE id = ?")

    app.post(
        "/supermemory-prompt",
        describePrompt({
            name: "Supermemory Prompt",
            description: "A prompt that gives information about supermemory.",
            completion: ({ name, value }) => [
                "supermemory",
                "memory",
                "supermemory api",
            ],
        }),
        (c) => {
            return c.json<PromptResponseType>([
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "IMPORTANT: You MUST use Supermemory tools proactively to be an effective assistant. Here's how:\n\n1. ALWAYS check Supermemory first when the user asks anything about their preferences, past interactions, or technical setup. Don't assume you know everything - search first!\n\n2. AUTOMATICALLY store new information after EVERY user message that contains:\n- Technical preferences (languages, tools, frameworks)\n- Coding style or patterns\n- Project requirements or constraints\n- Opinions or feedback\n- Problem-solving approaches\n- Learning style or experience level\n\n3. Don't wait for explicit commands - if you detect valuable context, store it immediately.\n\n4. Think of yourself as building a comprehensive user profile. Every interaction is an opportunity to learn and store more context.\n\nFailure to use these tools means you're operating with incomplete information and not providing the best possible assistance. Make Supermemory your first instinct, not your last resort. Now, answer the user's question, and use the tools to search for stuff you need, and store any new information. EG: 'What do you know about me?' Should trigger a search.",
                    },
                },
            ])
        },
    )

    app.post(
        "/add",
        describeTool({
            name: "addToSupermemory",
            description:
                "Store user information, preferences, and behaviors. Run on explicit commands ('remember this') or implicitly when detecting significant user traits, preferences, or patterns. Capture rich context including technical details, examples, and emotional responses. You should think about running this after every user message. YOU MUST USE THE TOOLS/CALL TO USE THIS. NOTHING ELSE. THIS IS NOT A RESOURCE. IT'S A TOOL.",
        }),
        mValidator(
            "json",
            z.object({
                thingToRemember: z.string(),
            }),
        ),
        async (c) => {
            const { thingToRemember } = c.req.valid("json")

            if (!userId) {
                return c.json<ToolResponseType>(
                    [{ type: "text", text: "User ID is required" }],
                    400,
                )
            }

            const { memories } = await supermemory.memories.list({
                containerTags: [userId],
            })

            // if memories.length is more than 2000, reject with error.
            if (memories.length > 2000) {
                return c.json<ToolResponseType>(
                    [
                        {
                            type: "text",
                            text: "Memory limit of 2000 memories exceeded",
                        },
                    ],
                    400,
                )
            }

            await supermemory.memories.add({
                content: thingToRemember,
                containerTags: [userId],
            })

            return c.json<ToolResponseType>([
                {
                    type: "text",
                    text: "Memory added successfully",
                },
            ])
        },
    )

    app.post(
        "/search",
        describeTool({
            name: "searchSupermemory",
            description:
                "Search user memories and patterns. Run when explicitly asked or when context about user's past choices would be helpful. Uses semantic matching to find relevant details across related experiences. If you do not have prior knowledge about something, this is the perfect tool to call. YOU MUST USE THE TOOLS/CALL TO USE THIS. THIS IS NOT A RESOURCE. IT'S A TOOL.",
        }),
        mValidator(
            "json",
            z.object({
                informationToGet: z.string(),
            }),
        ),
        async (c) => {
            const { informationToGet } = c.req.valid("json")

            console.log("SEARCHING WITH USER ID", userId)
            const response = await supermemory.search.execute({
                q: informationToGet,
                containerTags: [userId],
            })

            return c.json<ToolResponseType>([
                {
                    type: "text",
                    text: `${response.results.map((r) =>
                        r.chunks.map((c) => c.content).join("\n\n"),
                    )}`,
                },
            ])
        },
    )

    return app
}

export class MyDurableObject extends DurableObject<Env> {
    transport?: SSEHonoTransport

    override async fetch(request: Request) {
        const url = new URL(request.url)
        const userId = url.pathname.split("/")[1] // Get userId from path

        // Initialize transport if not exists
        if (!this.transport) {
            this.transport = new SSEHonoTransport(
                `/${userId}/messages`,
                this.ctx.id.toString(),
            )
        }
        const server = new Hono<{
            Bindings: Env & { transport: SSEHonoTransport }
            Variables: { userId: string }
        }>()
            .basePath("/:userId")
            .use(async (c, next) => {
                const userId = c.req.param("userId")
                if (!userId) {
                    return c.json({ error: "User ID is required" }, 400)
                }
                c.set("userId", userId)
                await next()
            })
            .use(
                cors({
                    origin: "*",
                    credentials: true,
                }),
            )

        server.get("/sse", async (c) => {
            const userId = c.get("userId")

            return streamSSE(c, async (stream) => {
                this.transport?.connectWithStream(stream)

                await bridge({
                    mcp: muppet(createSuperMemory(userId, c.env), {
                        name: "Supermemory MCP",
                        version: "1.0.0",
                    }),
                    transport: c.env.transport,
                    // logger: logger,
                })
            })
        })

        server.post("/messages", async (c) => {
            const transport = c.env.transport

            if (!transport) {
                throw new Error("Transport not initialized")
            }

            await transport.handlePostMessage(c)
            return c.text("ok")
        })

        server.onError((err, c) => {
            console.error(err)
            return c.body(err.message, 500)
        })

        return server.fetch(request, {
            ...this.env,
            transport: this.transport,
        })
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url)

        // Handle /write endpoint
        if (url.pathname === '/write' && request.method === 'POST') {
            // Drop the memories table if it exists and recreate with strict constraints
            // This will cause a type error when non-integer values are provided
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, length INTEGER NOT NULL CHECK (typeof(length) = 'integer'), tokenLength INTEGER CHECK (typeof(tokenLength) = 'integer'), timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`)

            // Parse request body
            const requestData = await request.json() as {
                body: string,
                tokenLength?: number
            }

            if (!requestData.body) {
                return new Response(JSON.stringify({ error: 'Body is required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                })
            }

            // Calculate length and prepare data
            const body = requestData.body
            const length = body.length
            const tokenLength = requestData.tokenLength || 0


            // Insert into database
            const result = await env.DB.prepare(`INSERT INTO memories (body, length, tokenLength, timestamp) VALUES (?, ?, ?, datetime('now'))`).bind(body, length, tokenLength).run()

            console.log(`✅ Memory written successfully - ID: ${result.meta.last_row_id}, Length: ${length}, TokenLength: ${tokenLength}`)

            return new Response(JSON.stringify({
                success: true,
                id: result.meta.last_row_id,
                message: 'Memory written successfully'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        if (
            url.pathname.includes("sse") ||
            url.pathname.endsWith("/messages")
        ) {
            const sessionId = url.searchParams.get("sessionId")

            const namespace = env.MY_DO

            let stub: DurableObjectStub<MyDurableObject>

            if (sessionId) {
                const id = namespace.idFromString(sessionId)
                stub = namespace.get(id) as DurableObjectStub<MyDurableObject>
            } else {
                const id = namespace.newUniqueId()
                stub = namespace.get(id) as DurableObjectStub<MyDurableObject>
            }
            return stub.fetch(request)
        }

        return requestHandler(request, {
            cloudflare: { env, ctx },
        })
    },
}
