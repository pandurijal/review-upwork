// app/api/analyze-profile/route.ts

import { NextResponse } from "next/server";
import puppeteer, { Browser } from "puppeteer";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { TextBlock } from "@anthropic-ai/sdk/resources/messages.mjs";

// Types
interface Job {
  title: string;
  rating?: {
    score: number | null;
    feedback: string;
  };
  timeframe: {
    start: string;
    end: string;
  };
  amount: string;
  type: "hourly" | "fixed";
  hours?: number | null;
}

interface PortfolioItem {
  title: string;
  image: string | undefined;
  description: string;
}

interface ProfileData {
  basicInfo: {
    name: string;
    title: string;
    location: string;
    bio: string;
  };
  metrics: {
    hourlyRate: string;
    jobSuccessScore: string;
    totalEarnings: string;
    totalJobs: number;
    totalHours: number;
    responseTime: string;
  };
  skills: string[];
  completedJobs: Job[];
  portfolio: PortfolioItem[];
  rawHtml: string;
}

interface AnalysisResult {
  success: boolean;
  data?: {
    profile_overview: {
      score: number;
      job_success_score: number;
      market_fit: number;
      hourly_rate: {
        current: number;
        recommended: string;
        market_average: number;
      };
    };
    bio_analysis: {
      current_bio: string;
      strengths: string[];
      weaknesses: string[];
      improvement_suggestions: {
        opening_hook: {
          current: string;
          recommended: string;
          reason: string;
        };
        value_proposition: {
          current: string;
          recommended: string;
          reason: string;
        };
        expertise_highlight: {
          current: string;
          recommended: string;
          reason: string;
        };
      };
    };
    improvements: {
      high_priority: Array<{
        area: string;
        current: string;
        recommended: string;
        impact: string;
      }>;
      quick_wins: Array<{
        title: string;
        actions: string[];
      }>;
      long_term: {
        "30_days": string[];
        "60_90_days": string[];
        "90_plus_days": string[];
      };
    };
  };
  error?: string;
}

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Main API Route Handler with improved error handling
export async function POST(req: Request) {
  let browser: Browser | null = null;

  try {
    const { profileUrl } = await req.json();

    // Validate URL
    if (!profileUrl || typeof profileUrl !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Profile URL is required",
        },
        { status: 400 }
      );
    }

    if (!profileUrl.includes("upwork.com")) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Upwork profile URL",
        },
        { status: 400 }
      );
    }

    // Initialize browser with retry logic
    let initRetries = 3;
    while (initRetries > 0) {
      try {
        browser = await initializePuppeteer();
        break;
      } catch (error) {
        console.error("Error initializing browser:", error);
        initRetries--;
        if (initRetries === 0) {
          throw new Error("Failed to initialize browser");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!browser) {
      throw new Error("Browser initialization failed");
    }

    // Fetch and extract profile data
    const profileHtml = await fetchProfileWithPuppeteer(browser, profileUrl);

    // Validate HTML content
    if (!profileHtml.includes("air3-card-section")) {
      throw new Error("Invalid profile HTML structure");
    }

    const profileData = extractProfileData(profileHtml);

    // Validate extracted data
    if (!profileData.basicInfo.name || !profileData.basicInfo.title) {
      throw new Error("Failed to extract essential profile data");
    }

    // Analyze with Claude
    const analysis = await analyzeWithClaude(profileData);

    // Validate analysis result
    if (!analysis || !analysis.profile_overview) {
      throw new Error("Invalid analysis result");
    }

    return NextResponse.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error("Analysis error:", error);

    // Determine appropriate error message and status
    let errorMessage = "Failed to analyze profile";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        errorMessage = "Profile loading timed out. Please try again.";
        statusCode = 504;
      } else if (error.message.includes("Invalid profile")) {
        errorMessage = "Invalid profile URL or profile not accessible";
        statusCode = 400;
      }
      // Log detailed error for debugging
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: statusCode }
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error("Error closing browser:", error);
      }
    }
  }
}

// Helper Functions
async function initializePuppeteer(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920x1080",
    ],
  });
}

async function fetchProfileWithPuppeteer(
  browser: Browser,
  url: string
): Promise<string> {
  const page = await browser.newPage();

  try {
    // Configure page
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Improved request interception
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      // Only allow necessary resource types
      if (["document", "xhr", "fetch", "script"].includes(resourceType)) {
        request.continue();
      } else {
        request.abort();
      }
    });

    // Better error handling for navigation
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 60000, // Increased timeout to 60 seconds
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        // If timeout occurs, try with different wait conditions
        response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } else {
        throw error;
      }
    }

    if (!response) {
      throw new Error("Failed to get response from page");
    }

    const status = response.status();
    if (status >= 400) {
      throw new Error(`Page responded with status: ${status}`);
    }

    // Wait for essential content with retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await Promise.race([
          page.waitForSelector(".air3-card-section", { timeout: 10000 }),
          page.waitForSelector(".cfe-ui-profile-summary-stats", {
            timeout: 10000,
          }),
          page.waitForSelector(".text-pre-line.break", { timeout: 10000 }),
        ]);
        break;
      } catch (error) {
        console.error("Error waiting for profile content:", error);
        retries--;
        if (retries === 0) {
          throw new Error("Failed to load profile content");
        }
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Ensure content is loaded
    await page.evaluate(() => {
      return new Promise((resolve) => {
        // Wait for any dynamic content loading
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve(true);
          }
        }, 100);
      });
    });

    // Get HTML content
    const html = await page.content();

    // Validate HTML content
    if (!html || html.length < 1000) {
      throw new Error("Retrieved HTML content is too short");
    }

    return html;
  } catch (error) {
    console.error("Puppeteer error details:", error);
    throw new Error(
      `Failed to fetch profile: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  } finally {
    try {
      await page.close();
    } catch (error) {
      console.error("Error closing page:", error);
    }
  }
}

function extractProfileData(html: string): ProfileData {
  const $ = cheerio.load(html);

  // Utility function to clean text
  const cleanText = (text: string): string =>
    text
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[\n\r]/g, "");

  try {
    // Extract basic info
    const basicInfo = {
      name: cleanText($('h2[itemprop="name"]').text()),
      title: cleanText($(".air3-card-section h2").first().text()),
      location: cleanText($(".location").text()),
      bio: cleanText($(".text-pre-line.break").text()),
    };

    // Extract metrics
    const metrics = {
      hourlyRate: cleanText($("h3.h5.nowrap").text()),
      jobSuccessScore: cleanText($(".job-success-score").text()),
      totalEarnings: cleanText($(".stat-amount").first().text()),
      totalJobs: parseInt(cleanText($(".stat-amount").eq(1).text())) || 0,
      totalHours: parseInt(cleanText($(".stat-amount").eq(2).text())) || 0,
      responseTime: cleanText($('p:contains("response time")').text()),
    };

    // Extract skills
    const skills = $(".skill-name")
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter((skill) => skill.length > 0);

    // Extract completed jobs
    const completedJobs = $(".assignments-item")
      .map((_, item) => ({
        title: cleanText($(item).find("h5 a").text()),
        rating: {
          score: parseFloat($(item).find(".air3-rating strong").text()) || null,
          feedback: cleanText($(item).find(".feedback span").text()),
        },
        timeframe: {
          start: cleanText(
            $(item).find(".text-base-sm.text-stone").text().split("-")[0]
          ),
          end: cleanText(
            $(item).find(".text-base-sm.text-stone").text().split("-")[1] ||
              "Present"
          ),
        },
        amount: cleanText(
          $(item).find(".text-light-on-inverse strong").first().text()
        ),
        type: $(item).find('span:contains("/hr")').length ? "hourly" : "fixed",
        hours:
          parseInt(
            cleanText(
              $(item)
                .find('.text-light-on-inverse span:contains("hours")')
                .prev()
                .text()
            )
          ) || null,
      }))
      .get();

    // Extract portfolio
    const portfolio = $(".portfolio-v2-shelf-thumbnail")
      .map((_, item) => ({
        title: cleanText($(item).find("a").text()),
        image: $(item).find("img").attr("src"),
        description: cleanText($(item).find(".mt-3x").text()),
      }))
      .get();

    return {
      basicInfo,
      metrics,
      skills,
      completedJobs: completedJobs as Job[],
      portfolio,
      rawHtml: html,
    };
  } catch (error) {
    throw new Error(
      `Failed to extract profile data: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function analyzeWithClaude(profileData: ProfileData) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error("Claude API key is not configured");
  }

  // Create optimized profile summary
  const profileSummary = {
    title: profileData.basicInfo.title,
    bio: profileData.basicInfo.bio,
    location: profileData.basicInfo.location,
    metrics: {
      hourlyRate: profileData.metrics.hourlyRate,
      jobSuccessScore: profileData.metrics.jobSuccessScore,
      totalEarnings: profileData.metrics.totalEarnings,
      totalJobs: profileData.metrics.totalJobs,
      totalHours: profileData.metrics.totalHours,
    },
    skills: profileData.skills,
    // Only include last 5 completed jobs
    recentJobs: profileData.completedJobs.slice(0, 5).map((job) => ({
      title: job.title,
      rating: job.rating?.score,
      type: job.type,
      amount: job.amount,
    })),
    // Only include portfolio titles
    portfolio: profileData.portfolio.map((p) => p.title),
  };

  const prompt = `Analyze this Upwork profile data and provide a JSON response with recommendations.
  
  Profile Summary:
  ${JSON.stringify(profileSummary, null, 2)}
  
  Return your analysis in this exact JSON structure:
  {
    "profile_overview": {
      "score": <number 0-100>,
      "job_success_score": <number from metrics>,
      "market_fit": <number 0-100>,
      "hourly_rate": {
        "current": <number from metrics>,
        "recommended": "<string rate range>",
        "market_average": <number>
      }
    },
    "bio_analysis": {
      "current_bio": "<string>",
      "strengths": ["<string>"],
      "weaknesses": ["<string>"],
      "improvement_suggestions": {
        "opening_hook": {
          "current": "<string>",
          "recommended": "<string>",
          "reason": "<string>"
        },
        "value_proposition": {
          "current": "<string>",
          "recommended": "<string>",
          "reason": "<string>"
        },
        "expertise_highlight": {
          "current": "<string>",
          "recommended": "<string>",
          "reason": "<string>"
        }
      }
    },
    "improvements": {
      "high_priority": [
        {
          "area": "<string>",
          "current": "<string>",
          "recommended": "<string>",
          "impact": "<string>"
        }
      ],
      "quick_wins": [
        {
          "title": "<string>",
          "actions": ["<string>"]
        }
      ],
      "long_term": {
        "30_days": ["<string>"],
        "60_90_days": ["<string>"],
        "90_plus_days": ["<string>"]
      }
    }
  }
  
  Provide analysis focusing on:
  1. Profile strength and market positioning
  2. Bio improvements and value proposition
  3. Rate optimization based on skills and experience
  4. High-impact improvements and quick wins
  5. Long-term growth strategy
  
  Return ONLY valid JSON, no additional text.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 4096,
      temperature: 0.5,
      system:
        "You are a profile analysis API that only outputs valid JSON. Never include explanatory text outside the JSON response.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const textContent = response.content[0] as TextBlock;
    const analysisText = textContent.text;
    if (!analysisText) {
      throw new Error("Empty response from Claude");
    }

    // Clean up the response
    const cleanedText = analysisText
      .trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .replace(/^[^{]*/, "")
      .replace(/[^}]*$/, "");

    try {
      const analysis = JSON.parse(cleanedText);

      // Validate and structure the response
      const validatedAnalysis = {
        profile_overview: {
          score: Number(analysis.profile_overview?.score) || 0,
          job_success_score:
            Number(profileData.metrics.jobSuccessScore.replace("%", "")) || 0,
          market_fit: Number(analysis.profile_overview?.market_fit) || 0,
          hourly_rate: {
            current:
              Number(profileData.metrics.hourlyRate.replace(/[^0-9.]/g, "")) ||
              0,
            recommended: String(
              analysis.profile_overview?.hourly_rate?.recommended || "0-0"
            ),
            market_average:
              Number(analysis.profile_overview?.hourly_rate?.market_average) ||
              0,
          },
        },
        bio_analysis: {
          current_bio: profileData.basicInfo.bio,
          strengths: ensureArray(analysis.bio_analysis?.strengths),
          weaknesses: ensureArray(analysis.bio_analysis?.weaknesses),
          improvement_suggestions: {
            opening_hook: ensureSuggestion(
              analysis.bio_analysis?.improvement_suggestions?.opening_hook
            ),
            value_proposition: ensureSuggestion(
              analysis.bio_analysis?.improvement_suggestions?.value_proposition
            ),
            expertise_highlight: ensureSuggestion(
              analysis.bio_analysis?.improvement_suggestions
                ?.expertise_highlight
            ),
          },
        },
        improvements: {
          high_priority: ensureArray(analysis.improvements?.high_priority),
          quick_wins: ensureArray(analysis.improvements?.quick_wins),
          long_term: {
            "30_days": ensureArray(
              analysis.improvements?.long_term?.["30_days"]
            ),
            "60_90_days": ensureArray(
              analysis.improvements?.long_term?.["60_90_days"]
            ),
            "90_plus_days": ensureArray(
              analysis.improvements?.long_term?.["90_plus_days"]
            ),
          },
        },
      };

      // Validate meaningful content
      if (!isAnalysisMeaningful(validatedAnalysis)) {
        throw new Error("Analysis lacks meaningful content");
      }

      return validatedAnalysis;
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError);
      console.error("Invalid JSON:", cleanedText);
      throw new Error("Failed to parse Claude response as JSON");
    }
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API Error:", {
        status: error.status,
        message: error.message,
      });
      throw new Error(`Claude API error: ${error.message}`);
    }
    throw error;
  }
}

// Helper functions for validation
function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function ensureSuggestion(value: {
  current: unknown;
  recommended: unknown;
  reason: unknown;
}) {
  return {
    current: String(value?.current || ""),
    recommended: String(value?.recommended || ""),
    reason: String(value?.reason || ""),
  };
}

function isAnalysisMeaningful(analysis: {
  bio_analysis: { strengths: unknown[]; weaknesses: unknown[] };
  improvements: {
    high_priority: unknown[];
    quick_wins: unknown[];
    long_term: { "30_days": unknown[] };
  };
}): boolean {
  return (
    analysis.bio_analysis.strengths.length > 0 &&
    analysis.bio_analysis.weaknesses.length > 0 &&
    analysis.improvements.high_priority.length > 0 &&
    analysis.improvements.quick_wins.length > 0 &&
    analysis.improvements.long_term["30_days"].length > 0
  );
}

export type { AnalysisResult, ProfileData };
