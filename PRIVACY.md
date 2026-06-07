Ballpark — Privacy Policy
Effective date: May 31st, 2026
Developer: Stephenie L
Contact: stephenie.uniai@gmail.com

Ballpark is a Chrome extension that helps you calibrate unfamiliar numbers while reading on the web. This policy explains exactly what data Ballpark accesses, where it goes, and what is stored. It is written to match both the extension's actual behavior and the disclosures in the Chrome Web Store "Privacy Practices" tab.
Single purpose
Ballpark has one purpose: when you click a number on a web page, it generates a short, directional "is this number large, small, or typical" calibration for that number. Every data practice below exists only to serve that single, user-initiated feature.
What data Ballpark accesses, and why
Ballpark accesses page content only at the moment you click an underlined number — never in the background, and never on pages where you don't interact with it. When you click, it reads:

The number you clicked
Approximately 200 characters of text surrounding that number, to give the model context
The page title and URL, to help the model understand the subject matter

This information is used solely to produce the calibration card for that click.
What data is transmitted, and to whom
To generate a calibration, the data above is sent to Anthropic (the provider of the Claude AI model), using your own Anthropic API key. The request goes directly from your browser to Anthropic's API; it does not pass through any server operated by Ballpark or its developer.

Anthropic's handling of this data is governed by its own terms:

Anthropic Privacy Policy: https://www.anthropic.com/legal/privacy
Anthropic Commercial Terms / API usage policies: https://www.anthropic.com/legal/commercial-terms

If the model performs an optional web search to ground its answer, the search query is handled by Anthropic's server-side search tool under the same terms.
What data is stored, and where
The only data Ballpark stores is your Anthropic API key, which you enter yourself. It is kept locally on your device using Chrome's chrome.storage.local API. It is never transmitted anywhere except to Anthropic as the credential for your own API calls. It is not sent to the developer or any third party.
What the developer collects
Nothing. Ballpark has no backend server, no analytics, no telemetry, no advertising, and no tracking. The developer does not collect, receive, store, sell, or share any of your data. None of the data Ballpark reads from pages is ever sent to the developer.
Web browsing activity
Ballpark reads page content (text near the clicked number, plus the page title and URL) strictly to deliver the user-facing calibration feature described above. It does not collect, log, or transmit your browsing history, and it does not monitor pages in the background.
Data retention and deletion
Your API key remains in local storage until you remove it. You can delete it at any time by clearing it in the extension popup, or by removing the extension, which deletes all locally stored data. Because the developer stores no data, there is nothing on the developer's side to request access to or deletion of.

To request deletion of any data Anthropic may retain from your API calls, contact Anthropic directly under their privacy policy.
Children
Ballpark is not directed to children and does not knowingly collect data from anyone.
Changes to this policy
If this policy changes, the updated version will be posted at this URL with a revised effective date.