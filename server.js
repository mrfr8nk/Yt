const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

app.use(express.json());

// Helper function to extract YouTube ID
function getYouTubeVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|embed|watch|shorts)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[&?]|$)/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// Helper function to map audio quality to internal format
function getAudioQualityValue(audioQuality) {
    switch (parseInt(audioQuality)) {
        case 320: return 0;
        case 256: return 1;
        case 128: return 4;
        case 96: return 5;
        default: return 4; // Default to 128kbps
    }
}

// Helper function to map video quality to internal format
function getVideoQualityValue(videoQuality) {
    switch (parseInt(videoQuality)) {
        case 1080: return 0;
        case 720: return 1;
        case 480: return 2;
        case 360: return 3;
        case 144: return 4;
        default: return 1; // Default to 720p
    }
}

// Updated headers function
function getHeaders() {
    return {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        'Origin': 'https://cnvmp3.com',
        'Referer': 'https://cnvmp3.com/v25',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
}

// Helper function to make API requests
async function makeRequest(url, data) {
    const response = await axios.post(url, data, {
        headers: getHeaders(),
        httpsAgent: new (require('https').Agent)({ 
            rejectUnauthorized: false 
        })
    });
    return response.data;
}

// Unified download endpoint with type parameter
app.get('/api/download', async (req, res) => {
    try {
        const { url, type = 'mp3', quality = type === 'mp3' ? '128' : '720' } = req.query;
        
        // Validate inputs
        if (!url) {
            return res.status(400).json({ error: 'YouTube URL is required' });
        }

        const youtubeId = getYouTubeVideoId(url);
        if (!youtubeId) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Validate type and quality
        if (!['mp3', 'mp4'].includes(type.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid type. Valid options: mp3, mp4' });
        }

        const formatValue = type === 'mp3' ? 1 : 2;
        let qualityValue, validQualities;

        if (type === 'mp3') {
            validQualities = ['96', '128', '256', '320'];
            if (!validQualities.includes(quality)) {
                return res.status(400).json({ 
                    error: 'Invalid audio quality. Valid options: 96, 128, 256, 320' 
                });
            }
            qualityValue = getAudioQualityValue(quality);
        } else {
            validQualities = ['144', '360', '480', '720', '1080'];
            if (!validQualities.includes(quality)) {
                return res.status(400).json({ 
                    error: 'Invalid video quality. Valid options: 144, 360, 480, 720, 1080' 
                });
            }
            qualityValue = getVideoQualityValue(quality);
        }

        // First check database
        const checkDbResponse = await makeRequest('https://cnvmp3.com/check_database.php', {
            youtube_id: youtubeId,
            quality: qualityValue
        });

        if (checkDbResponse.success && checkDbResponse.download_link) {
            return res.json({ 
                success: true,
                type: type,
                quality: quality,
                downloadUrl: checkDbResponse.download_link,
                info: 'Use this URL immediately as it may expire'
            });
        }

        // Get video data
        const videoDataResponse = await makeRequest('https://cnvmp3.com/get_video_data.php', {
            url: url,
            token: "1234" // Static token works fine
        });

        if (!videoDataResponse.success) {
            throw new Error(videoDataResponse.error || 'Failed to get video data');
        }

        const title = videoDataResponse.title;

        // Download the file
        const downloadResponse = await makeRequest('https://cnvmp3.com/download_video_ucep.php', {
            url: url,
            quality: qualityValue,
            title: title,
            formatValue: formatValue
        });

        if (!downloadResponse.success) {
            if (downloadResponse.errorType === 4) {
                return res.status(429).json({ 
                    error: 'Rate limited, please try again later',
                    retryAfter: 60 // Suggested retry after 60 seconds
                });
            }
            throw new Error(downloadResponse.error || 'Failed to generate download link');
        }

        // Insert to database (fire and forget)
        makeRequest('https://cnvmp3.com/insert_to_database.php', {
            youtube_id: youtubeId,
            server_path: downloadResponse.download_link,
            quality: qualityValue,
            title: title,
            formatValue: formatValue
        }).catch(console.error);

        return res.json({ 
            success: true,
            type: type,
            quality: quality,
            title: title,
            downloadUrl: downloadResponse.download_link,
            info: 'Use this URL immediately as it may expire'
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            success: false,
            error: error.message || 'Internal server error' 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
