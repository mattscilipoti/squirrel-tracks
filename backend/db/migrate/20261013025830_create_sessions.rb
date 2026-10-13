class CreateSessions < ActiveRecord::Migration[8.1]
  def change
    create_table :sessions do |t|
      t.integer :status, default: 0, null: false

      t.timestamps
    end
  end
end
