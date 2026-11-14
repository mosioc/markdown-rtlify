# مفاهیم پیشرفته در یادگیری تقویتی عمیق

Policy Gradient خانواده‌ای از الگوریتم‌هاست که به‌جای تخمین تابع ارزش، مستقیماً پارامترهای سیاست \( \pi_\theta(a|s) \) را بهینه می‌کند؛ مثل REINFORCE، A2C و PPO.

## 1. قضیه Policy Gradient

هدف بیشینه‌سازی بازده مورد انتظار \( J(\theta) \) است و گرادیان آن به این شکل نوشته می‌شود:

\[
\nabla_\theta J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta}\left[ \sum_{t=0}^{T} \nabla_\theta \log \pi_\theta(a_t|s_t)\, A^{\pi}(s_t,a_t) \right]
\]

که در آن:

- \( \tau \): یک مسیر (Trajectory) کامل شامل حالت‌ها و اقدامات
- \( A^{\pi}(s,a) = Q^{\pi}(s,a) - V^{\pi}(s) \): تابع Advantage
  - اگر \( A > 0 \) باشد، Action بهتر از میانگین بوده است.
  - اگر \( A < 0 \) باشد، Action بدتر از میانگین بوده است.
    - در عمل، Advantage معمولاً نرمال‌سازی می‌شود (میانگین صفر و واریانس یک).

## 2. Generalized Advantage Estimation (GAE)

GAE بین Bias و Variance تعادل برقرار می‌کند و با پارامتر \( \lambda \in [0,1] \) کنترل می‌شود:

\[
\begin{aligned}
\delta_t &= r_t + \gamma V(s_{t+1}) - V(s_t) \\
\hat{A}_t &= \sum_{l=0}^{\infty} (\gamma\lambda)^l \, \delta_{t+l}
\end{aligned}
\]

- با \( \lambda = 0 \): فقط یک گام (Bias زیاد، Variance کم)
- با \( \lambda = 1 \): معادل Monte Carlo (Bias کم، Variance زیاد)

## 3. Proximal Policy Optimization (PPO)

PPO با محدود کردن اندازه به‌روزرسانی سیاست، آموزش را پایدار می‌کند. ابتدا نسبت احتمال را تعریف می‌کنیم:

\[
r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\text{old}}}(a_t|s_t)}
\]

سپس تابع هدف Clipped:

\[
L^{\text{CLIP}}(\theta) = \mathbb{E}_t\left[ \min\left( r_t(\theta)\hat{A}_t,\ \operatorname{clip}\big(r_t(\theta), 1-\epsilon, 1+\epsilon\big)\hat{A}_t \right) \right]
\]

عملکرد تابع \( \operatorname{clip} \) را می‌توان این‌طور نوشت:

\[
\operatorname{clip}(r, 1-\epsilon, 1+\epsilon) =
\begin{cases}
1-\epsilon & r < 1-\epsilon \\
r & 1-\epsilon \le r \le 1+\epsilon \\
1+\epsilon & r > 1+\epsilon
\end{cases}
\]

پیاده‌سازی ساده در PyTorch:

```python
import torch

def ppo_loss(new_logp, old_logp, advantages, eps=0.2):
    ratio = torch.exp(new_logp - old_logp)  # نسبت سیاست جدید به قدیم
    unclipped = ratio * advantages
    clipped = torch.clamp(ratio, 1 - eps, 1 + eps) * advantages
    return -torch.min(unclipped, clipped).mean()  # کمینه‌سازی منفی هدف
```

> نکته: مقدار رایج \( \epsilon = 0.2 \) است، اما برای محیط‌های حساس‌تر ممکن است نیاز به تنظیم دقیق‌تر (Hyperparameter Tuning) داشته باشد.

## 4. روش‌های Value-based پیشرفته

معادله Bellman Optimality پایه الگوریتم‌های Q-Learning است:

\[
Q^_(s,a) = \sum_{s'} P(s'|s,a)\left[ R(s,a,s') + \gamma \max_{a'} Q^_(s',a') \right]
\]

| الگوریتم | ایده اصلی | مشکل حل‌شده |
| --- | --- | --- |
| DQN | تقریب \( Q(s,a;\theta) \) با شبکه عصبی | فضای حالت بزرگ |
| Double DQN | جدا کردن انتخاب و ارزیابی Action | بیش‌برآورد (Overestimation) |
| Dueling DQN | تفکیک \( V(s) \) و \( A(s,a) \) | یادگیری کارآمدتر ارزش حالت |
| Prioritized Replay | نمونه‌برداری بر اساس خطای TD | استفاده بهتر از تجربه‌ها |

تابع زیان DQN با شبکه هدف (Target Network) با پارامتر \( \theta^- \):

\[
\mathcal{L}(\theta) = \mathbb{E}_{(s,a,r,s')}\left[ \left( r + \gamma \max_{a'} Q(s',a';\theta^-) - Q(s,a;\theta) \right)^2 \right]
\]

## 5. معماری Actor-Critic

در این معماری یک بخش (Actor) سیاست را یاد می‌گیرد و بخش دیگر (Critic) ارزش را تخمین می‌زند:

```text
           state s_t
               |
               v
      +------------------+
      |  Shared Network  |
      +------------------+
         |            |
         v            v
  +-------------+ +-------------+
  |    Actor    | |    Critic   |
  |  pi(a | s)  | |    V(s)     |
  +-------------+ +-------------+
         |            |
         v            v
      action     value estimate
```

1. **Actor** سیاست را با گرادیان Policy به‌روز می‌کند.
2. **Critic** با خطای TD آموزش می‌بیند:
   - هدف Critic کمینه کردن این مقدار است:
     \[
     \mathcal{L}_V = \left( r_t + \gamma V(s_{t+1}) - V(s_t) \right)^2
     \]
   - خروجی Critic به‌عنوان Baseline برای کاهش Variance استفاده می‌شود.
3. در عمل هر دو بخش اغلب لایه‌های ابتدایی را به اشتراک می‌گذارند (Shared Backbone).

## 6. Maximum Entropy RL و SAC

Soft Actor-Critic علاوه بر پاداش، آنتروپی سیاست را هم بیشینه می‌کند تا Exploration بهتر شود:

\[
J(\pi) = \sum_{t=0}^{T} \mathbb{E}_{(s_t,a_t)\sim\rho_\pi}\left[ r(s_t,a_t) + \alpha\, \mathcal{H}\big(\pi(\cdot|s_t)\big) \right]
\]

پارامتر دما \( \alpha \) تعادل بین Exploitation و Exploration را کنترل می‌کند؛ هرچه بزرگ‌تر باشد، سیاست تصادفی‌تر می‌ماند.

## 7. مقایسه خانواده‌ها

| ویژگی | Value-based | Policy-based | Actor-Critic |
| --- | --- | --- | --- |
| خروجی اصلی | \( Q(s,a) \) | \( \pi(a \mid s) \) | هر دو |
| فضای اقدام پیوسته | دشوار | مناسب | مناسب |
| Sample Efficiency | بالا (Off-policy) | پایین | متوسط تا بالا |
| نمونه | DQN | REINFORCE | PPO و SAC |

## 8. نکات عملی

In practice, نتیجه به **Seed**، نرمال‌سازی Observation و تنظیم Learning Rate حساس است؛ بنابراین حداقل ۵ اجرای مستقل با Seed متفاوت را گزارش کنید (مثلاً `seed=0..4`).

برای مطالعه بیشتر: [مقاله PPO](https://arxiv.org/abs/1707.06347)، [مقاله SAC](https://arxiv.org/abs/1801.01290) و [مقاله GAE](https://arxiv.org/abs/1506.02438).

~~استفاده از Reward خام بدون نرمال‌سازی~~ بهتر است جایگزین شود با Reward Scaling و Gradient Clipping.
