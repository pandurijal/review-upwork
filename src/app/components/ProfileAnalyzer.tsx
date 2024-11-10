'use client';

import React, { useState } from 'react';
import { Search, CheckCircle, FileText, Target, Star, TrendingUp } from 'lucide-react';
import axios from 'axios';

// TypeScript interfaces
interface AnalysisResult {
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
    word_count: number;
    recommended_length: string;
    score: number;
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
}

interface ApiResponse {
    success: boolean;
    data: AnalysisResult;
    error?: string;
  }

export default function ProfileAnalyzer(): JSX.Element {
  const [url, setUrl] = useState<string>('');
  const [isAnalyzed, setIsAnalyzed] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleAnalyze = async (): Promise<void> => {
    if (!url) {
      setError('Please enter a profile URL');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await axios.post<ApiResponse>('/api/analyze-profile', {
        profileUrl: url
      });

      if (response.data.success) {
        setResult(response.data.data);
        setIsAnalyzed(true);
      } else {
        setError(response.data.error || 'Analysis failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze profile');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Upwork Profile Analyzer</h1>
        <p className="text-gray-600">Get comprehensive analysis and recommendations for your profile</p>
      </div>

      {/* Search Bar */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <div className="flex gap-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste your Upwork profile URL"
              className="flex-1 p-4 border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className="px-8 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium disabled:bg-blue-400"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Analyze Profile
                </>
              )}
            </button>
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg">
              {error}
            </div>
          )}
        </div>
      </div>

      {isAnalyzed && result && (
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Profile Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { label: 'Overall Score', value: result.profile_overview.score, symbol: '%', color: 'blue' },
              { label: 'Job Success', value: result.profile_overview.job_success_score, symbol: '%', color: 'green' },
              { label: 'Market Fit', value: result.profile_overview.market_fit, symbol: '%', color: 'purple' },
              { label: 'Hourly Rate', value: result.profile_overview.hourly_rate.current, symbol: '$', color: 'orange' }
            ].map((metric, i) => (
              <div key={i} className="bg-white p-6 rounded-xl shadow-sm">
                <div className="text-sm text-gray-500 mb-2">{metric.label}</div>
                <div className={`text-4xl font-bold text-${metric.color}-600`}>
                  {metric.symbol === '$' ? `$${metric.value}` : `${metric.value}%`}
                </div>
              </div>
            ))}
          </div>

          {/* Bio Analysis */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <FileText className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Profile Bio Analysis</h2>
            </div>
            
            <div className="space-y-6">
              {/* Current Bio */}
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-500 mb-2">Current Overview</div>
                <div className="text-gray-700">{result.bio_analysis.current_bio}</div>
                <div className="text-sm text-orange-600 mt-2">
                  {result.bio_analysis.word_count} words (Recommended: {result.bio_analysis.recommended_length})
                </div>
              </div>

              {/* Bio Structure Recommendations */}
              {Object.entries(result.bio_analysis.improvement_suggestions).map(([key, suggestion], index) => (
                <div key={index} className="border-l-4 border-green-500 pl-4">
                  <div className="font-medium mb-2">{key.split('_').join(' ').toUpperCase()}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm text-red-600">Current</div>
                      <div className="p-3 bg-red-50 rounded-lg text-sm text-gray-600">{suggestion.current}</div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-green-600">Improved</div>
                      <div className="p-3 bg-green-50 rounded-lg text-sm text-gray-600">{suggestion.recommended}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-500">{suggestion.reason}</div>
                </div>
              ))}
            </div>
          </div>

          {/* High-Impact Improvements */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Target className="w-5 h-5 text-orange-500" />
              <h2 className="text-lg font-semibold">High-Impact Improvements</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {result.improvements.high_priority.map((item, index) => (
                <div key={index} className="p-4 bg-orange-50 rounded-lg">
                  <div className="font-medium text-orange-800 mb-2">{item.area}</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Current:</span>
                      <span className="text-orange-700">{item.current}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Recommended:</span>
                      <span className="text-green-600">{item.recommended}</span>
                    </div>
                    <div className="text-orange-600 mt-2">{item.impact}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Wins */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Star className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-semibold">Quick Wins (24-48 Hours)</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {result.improvements.quick_wins.map((item, index) => (
                <div key={index} className="p-4 bg-green-50 rounded-lg">
                  <div className="font-medium mb-3">{item.title}</div>
                  <div className="space-y-2">
                    {item.actions.map((action, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-gray-600">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Long-term Strategy */}
          <div className="bg-white p-6 rounded-xl shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Long-term Growth Strategy</h2>
            </div>
            <div className="space-y-4">
              {Object.entries(result.improvements.long_term).map(([phase, actions], index) => (
                <div key={index} className="p-4 bg-purple-50 rounded-lg">
                  <div className="font-medium text-purple-800 mb-2">
                    {phase.split('_').join(' ').toUpperCase()}
                  </div>
                  <div className="space-y-2">
                    {actions.map((action, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-purple-500" />
                        <span className="text-sm text-purple-900">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}