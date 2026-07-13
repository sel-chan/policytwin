import { resetFixture } from "./fixture.mjs";

const result = resetFixture();
console.log(`Reset trusted refund fixture: ${result.currentHash}`);
