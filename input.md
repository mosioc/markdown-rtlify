# مقدمه‌ای بر یادگیری تقویتی عمیق (Deep RL)

Reinforcement Learning روشی است که در آن یک Agent از طریق تعامل با Environment و دریافت Reward یاد می‌گیرد چگونه تصمیم بگیرد (مثل AlphaGo و DQN).

Deep Reinforcement Learning ترکیبی از RL و Deep Learning است؛ شبکه‌های عصبی عمیق وظیفه تقریب سیاست (Policy) یا تابع ارزش (Value Function) را بر عهده دارند.

## اجزای اصلی

1. **Agent**: بخش تصمیم‌گیرنده که Action انتخاب می‌کند.
2. **Environment**: هر چیزی که خارج از کنترل مستقیم Agent است.
   - State با نماد \( s_t \) وضعیت فعلی محیط را نشان می‌دهد.
   - Observation ممکن است ناقص یا همراه نویز باشد.
3. **Reward**: سیگنال عددی که کیفیت نتیجه را مشخص می‌کند.

## فرمول‌ها

هدف Agent بیشینه‌سازی بازده تجمعی (Return) است:

\[ G_t = \sum_{k=0}^{\infty} \gamma^k r_{t+k+1} \]

سیاست Agent با \( \pi(a|s) \) نشان داده می‌شود و تابع ارزش وضعیت از معادله Bellman به دست می‌آید:

\[
V^{\pi}(s) = \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \left[ R(s,a,s') + \gamma V^{\pi}(s') \right]
\]

فرمول به‌روزرسانی Q-Learning:

- در حالت ساده: \[ Q(s,a) \leftarrow Q(s,a) + \alpha \left[ r + \gamma \max_{a'} Q(s',a') - Q(s,a) \right] \]
- پارامتر \( \gamma \in [0,1] \) ضریب تخفیف و \( \alpha \) نرخ یادگیری است.

## نمونه کد

حلقه تعامل Agent با محیط در کتابخانه `gymnasium` به این شکل است:

```python
import gymnasium as gym

env = gym.make("CartPole-v1")
obs, info = env.reset()

for step in range(1000):
    action = env.action_space.sample()  # انتخاب تصادفی
    obs, reward, terminated, truncated, info = env.step(action)
    if terminated or truncated:
        obs, info = env.reset()
```

> نکته: طراحی تابع Reward حساس است؛ اگر با هدف واقعی هماهنگ نباشد، Agent ممکن است رفتار ناخواسته یاد بگیرد (Reward Hacking).

## مقایسه چند الگوریتم

| الگوریتم | نوع | فضای اقدام |
| --- | --- | --- |
| DQN | Value-based | گسسته |
| PPO | Policy-based | گسسته و پیوسته |
| SAC | Actor-Critic | پیوسته |

PPO یکی از پرکاربردترین الگوریتم‌هاست، چون پایدار است و تنظیم هایپرپارامترهای آن نسبتاً ساده است.

In practice, deep RL agents often need millions of environment steps, so techniques like Experience Replay and Target Networks (که در DQN معرفی شد) are essential.

برای مطالعه بیشتر، [OpenAI Spinning Up](https://spinningup.openai.com) را ببینید.
