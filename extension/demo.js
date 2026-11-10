import {dayKey, defaults} from './core.js';
// Fully fictional public demo; titles describe scenarios, not a user browsing history.
const groups = [
  [
    "开发与技术",
    [
      [
        "GitHub · 开源项目入门",
        "github.com"
      ],
      [
        "MDN · JavaScript 基础指南",
        "developer.mozilla.org"
      ],
      [
        "Stack Overflow · 常见编程问题",
        "stackoverflow.com"
      ],
      [
        "GitHub · 网页开发示例",
        "github.com"
      ],
      [
        "npm · 常用前端工具",
        "npmjs.com"
      ],
      [
        "Microsoft Learn · 编程学习路径",
        "learn.microsoft.com"
      ],
      [
        "Wikipedia · 计算机科学概览",
        "wikipedia.org"
      ],
      [
        "YouTube · 网页布局教程",
        "youtube.com"
      ],
      [
        "CSS-Tricks · 弹性布局笔记",
        "css-tricks.com"
      ]
    ]
  ],
  [
    "设计与灵感",
    [
      [
        "Figma · 界面设计练习",
        "figma.com"
      ],
      [
        "Canva · 海报排版灵感",
        "canva.com"
      ],
      [
        "Unsplash · 自然风景摄影",
        "unsplash.com"
      ],
      [
        "Pinterest · 家居配色参考",
        "pinterest.com"
      ],
      [
        "Behance · 品牌设计作品",
        "behance.net"
      ],
      [
        "Dribbble · 移动应用界面",
        "dribbble.com"
      ],
      [
        "Google Fonts · 字体搭配练习",
        "fonts.google.com"
      ],
      [
        "Adobe · 配色与视觉设计",
        "adobe.com"
      ]
    ]
  ],
  [
    "旅行与地图",
    [
      [
        "Google Maps · 周末城市散步",
        "maps.google.com"
      ],
      [
        "Wikipedia · 世界城市介绍",
        "wikipedia.org"
      ],
      [
        "Tripadvisor · 博物馆游览参考",
        "tripadvisor.com"
      ],
      [
        "Booking.com · 住宿类型比较",
        "booking.com"
      ],
      [
        "Airbnb · 周末旅行灵感",
        "airbnb.com"
      ],
      [
        "携程 · 出行准备清单",
        "ctrip.com"
      ],
      [
        "哔哩哔哩 · 城市漫步视频",
        "bilibili.com"
      ],
      [
        "YouTube · 国家公园风景",
        "youtube.com"
      ]
    ]
  ],
  [
    "日常与协作",
    [
      [
        "Gmail · 邮件整理示例",
        "mail.google.com"
      ],
      [
        "Google Calendar · 每周安排示例",
        "calendar.google.com"
      ],
      [
        "Notion · 项目笔记模板",
        "notion.so"
      ],
      [
        "Google Drive · 文件分类示例",
        "drive.google.com"
      ],
      [
        "Trello · 团队看板示例",
        "trello.com"
      ],
      [
        "Gmail · 标签管理指南",
        "mail.google.com"
      ],
      [
        "Slack · 团队协作指南",
        "slack.com"
      ],
      [
        "Gmail · 搜索邮件技巧",
        "mail.google.com"
      ]
    ]
  ],
  [
    "科学与阅读",
    [
      [
        "NASA · 探索太阳系",
        "nasa.gov"
      ],
      [
        "Wikipedia · 海洋生态介绍",
        "wikipedia.org"
      ],
      [
        "BBC · 科学与自然阅读",
        "bbc.com"
      ],
      [
        "豆瓣 · 科普书籍浏览",
        "douban.com"
      ]
    ]
  ],
  [
    "音乐与放松",
    [
      [
        "Spotify · 轻音乐播放列表",
        "open.spotify.com"
      ],
      [
        "YouTube · 音乐与自然声音",
        "youtube.com"
      ]
    ]
  ]
];
export function demoState(){
 const records=groups.flatMap(([group,tabs])=>tabs.map(([title,domain],i)=>({id:`${group}-${i}`,title,domain,url:`https://${domain}/demo/${encodeURIComponent(group)}/${i}`,group,day:dayKey(),firstSeen:Date.now(),lastSeen:Date.now(),activations:0})));
 return {demoVersion:1,records,config:defaults(),tabs:records.map((r,i)=>({id:i,url:r.url})),today:dayKey(),hasKey:false};
}
