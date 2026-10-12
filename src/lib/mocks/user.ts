import type { UserPreferences } from '../types/index.js';

/**
 * Mock User Profile — Used as fallback when Tauri Store is not available.
 * DELETE THIS FILE when user profile comes from real persistence.
 */
export const MOCK_USER: UserPreferences = {
	name: 'Admin User',
	email: 'operator@example.com',
	avatar: '',
	currencySymbol: '$',
	currencyCode: 'AUD',
	measurementUnit: 'Metric',
	dateFormat: 'en-AU'
};
