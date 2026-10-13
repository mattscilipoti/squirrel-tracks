class CreateTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :tasks do |t|
      t.references :session, null: false, foreign_key: true
      t.string :name, null: false
      t.integer :duration_minutes, default: 0

      t.timestamps
    end
  end
end
