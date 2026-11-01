# コーディングプラクティス

## 原則

### 関数型アプローチ (FP)

- 純粋関数を優先
- 不変データ構造を使用
- 副作用を分離
- 型安全性を確保

### ドメイン駆動設計 (DDD)

- 値オブジェクトとエンティティを区別
- 集約で整合性を保証
- リポジトリでデータアクセスを抽象化
- 境界付けられたコンテキストを意識

### テスト駆動開発 (TDD)

- Red-Green-Refactorサイクル
- テストを仕様として扱う
- 小さな単位で反復
- 継続的なリファクタリング

## 実装パターン

### 型定義

```typescript
// ブランデッド型で型安全性を確保
type Branded<T, B> = T & { _brand: B };
type Money = Branded<number, "Money">;
type Email = Branded<string, "Email">;
```

### 値オブジェクト

- 不変
- 値に基づく同一性
- 自己検証
- ドメイン操作を持つ

```typescript
// 作成関数はバリデーション付き
function createMoney(amount: number): Result<Money, Error> {
  if (amount < 0) return err(new Error("負の金額不可"));
  return ok(amount as Money);
}
```

### エンティティ

- IDに基づく同一性
- 制御された更新
- 整合性ルールを持つ

### Result型

```typescript
type Result<T, E extends Error> = Ok<T> | Err<E>;
interface Ok<T> { readonly ok: true; readonly value: T; }
interface Err<E extends Error> { readonly ok: false; readonly err: E; }
```

- 成功/失敗を明示
- E extends Error 制約でスタックトレースとエコシステム整合性を保証
- 早期リターンパターンを使用
- エラーは BaseError を継承したクラスで定義し、context.type で細分化

### リポジトリ

- ドメインモデルのみを扱う
- 永続化の詳細を隠蔽
- テスト用のインメモリ実装を提供

### アダプターパターン

- 外部依存を抽象化
- インターフェースは呼び出し側で定義
- テスト時は容易に差し替え可能

## 実装手順

1. **型設計**
   - まず型を定義
   - ドメインの言語を型で表現

2. **純粋関数から実装**
   - 外部依存のない関数を先に
   - テストを先に書く

3. **副作用を分離**
   - IO操作は関数の境界に押し出す
   - 副作用を持つ処理をPromiseでラップ

4. **アダプター実装**
   - 外部サービスやDBへのアクセスを抽象化
   - テスト用モックを用意

## プラクティス

- 小さく始めて段階的に拡張
- 過度な抽象化を避ける
- コードよりも型を重視
- 複雑さに応じてアプローチを調整

## コードスタイル

- 関数優先（クラスは必要な場合のみ）
- 不変更新パターンの活用
- 早期リターンで条件分岐をフラット化
- エラーとユースケースの列挙型定義

## テスト戦略

- 純粋関数の単体テストを優先
- インメモリ実装によるリポジトリテスト
- テスト可能性を設計に組み込む
- アサートファースト：期待結果から逆算
## TypeScript

TypeScriptでのコーディングにおける一般的なベストプラクティスをまとめます。

### 方針

- 最初に型と、それを処理する関数のインターフェースを考える
- コードのコメントとして、そのファイルがどういう仕様化を可能な限り明記する
- 実装が内部状態を持たないとき、 class による実装を避けて関数を優先する
- 副作用を抽象するために、アダプタパターンで外部依存を抽象し、テストではインメモリなアダプタで処理する

### 型の使用方針

1. 具体的な型を使用
   - any の使用を避ける
   - unknown を使用してから型を絞り込む
   - Utility Types を活用する

2. 型エイリアスの命名
   - 意味のある名前をつける
   - 型の意図を明確にする
   ```ts
   // Good
   type UserId = string;
   type UserData = {
     id: UserId;
     createdAt: Date;
   };

   // Bad
   type Data = any;
   ```

### エラー処理

1. Result型の使用
   ```ts
   import { Ok, Err, type Result } from "../libs/lib";

   // エラーは BaseError を継承したレイヤー単位のクラスで表現する
   // context.type で細分化し、ES2022 Error.cause で原因チェーンを保持する
   class ApiError extends BaseError {
     constructor(
       public readonly context:
         | { type: "network"; status?: number }
         | { type: "notFound" }
         | { type: "unauthorized" },
       options?: { cause?: unknown }
     ) {
       super(`API error [${context.type}]`, options);
     }
   }

   async function fetchUser(id: string): Promise<Result<User, ApiError>> {
     try {
       const response = await fetch(`/api/users/${id}`);
       if (!response.ok) {
         switch (response.status) {
           case 404:
             return Err(new ApiError({ type: "notFound" }));
           case 401:
             return Err(new ApiError({ type: "unauthorized" }));
           default:
             return Err(new ApiError({ type: "network", status: response.status }));
         }
       }
       return Ok(await response.json());
     } catch (error) {
       return Err(new ApiError({ type: "network" }, { cause: error }));
     }
   }
   ```

2. エラー型の定義
   - BaseError を継承したレイヤー単位のクラスを定義する
   - context オブジェクト内の type フィールドで具体的なケースを列挙
   - ES2022 の Error.cause で原因チェーンを保持
   - instanceof でレイヤー単位の判別、context.type で詳細な判別

### 実装パターン

1. 関数ベース（状態を持たない場合）
   ```ts
   // インターフェース
   interface Logger {
     log(message: string): void;
   }

   // 実装
   function createLogger(): Logger {
     return {
       log(message: string): void {
         console.log(`[${new Date().toISOString()}] ${message}`);
       },
     };
   }
   ```

2. classベース（状態を持つ場合）
   ```ts
   interface Cache<T> {
     get(key: string): T | undefined;
     set(key: string, value: T): void;
   }

   class TimeBasedCache<T> implements Cache<T> {
     private items = new Map<string, { value: T; expireAt: number }>();

     constructor(private ttlMs: number) {}

     get(key: string): T | undefined {
       const item = this.items.get(key);
       if (!item || Date.now() > item.expireAt) {
         return undefined;
       }
       return item.value;
     }

     set(key: string, value: T): void {
       this.items.set(key, {
         value,
         expireAt: Date.now() + this.ttlMs,
       });
     }
   }
   ```

3. Adapterパターン（外部依存の抽象化）
   ```ts
   // 抽象化
   type Fetcher = <T>(path: string) => Promise<Result<T, ApiError>>;

   // 実装
   function createFetcher(headers: Record<string, string>): Fetcher {
     return async <T>(path: string) => {
       try {
         const response = await fetch(path, { headers });
         if (!response.ok) {
           return err({
             type: "network",
             message: `HTTP error: ${response.status}`,
           });
         }
         return ok(await response.json());
       } catch (error) {
         return err({
           type: "network",
           message: error instanceof Error ? error.message : "Unknown error",
         });
       }
     };
   }

   // 利用
   class ApiClient {
     constructor(
       private readonly getData: Fetcher,
       private readonly baseUrl: string,
     ) {}

     async getUser(id: string): Promise<Result<User, ApiError>> {
       return await this.getData(`${this.baseUrl}/users/${id}`);
     }
   }
   ```

### 実装の選択基準

1. 関数を選ぶ場合
   - 単純な操作のみ
   - 内部状態が不要
   - 依存が少ない
   - テストが容易

2. classを選ぶ場合
   - 内部状態の管理が必要
   - 設定やリソースの保持が必要
   - メソッド間で状態を共有
   - ライフサイクル管理が必要

3. Adapterを選ぶ場合
   - 外部依存の抽象化
   - テスト時のモック化が必要
   - 実装の詳細を隠蔽したい
   - 差し替え可能性を確保したい

### 一般的なルール

1. 依存性の注入
   - 外部依存はコンストラクタで注入
   - テスト時にモックに置き換え可能に
   - グローバルな状態を避ける

2. インターフェースの設計
   - 必要最小限のメソッドを定義
   - 実装の詳細を含めない
   - プラットフォーム固有の型を避ける

3. テスト容易性
   - モックの実装を簡潔に
   - エッジケースのテストを含める
   - テストヘルパーを適切に分離

4. コードの分割
   - 単一責任の原則に従う
   - 適切な粒度でモジュール化
   - 循環参照を避ける
